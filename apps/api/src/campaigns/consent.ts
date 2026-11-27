/**
 * WhatsApp consent: the single place that decides whether a lead may be messaged, and the single writer of consent rows.
 *
 * Rules (audit S-01, DPDP):
 *  - The ledger (`consents`) is append-only. The newest row decides, except that an opt-out ALWAYS wins until an explicit opt-in follows it.
 *  - A customer-initiated message is only SERVICE consent (we may reply). Business-initiated MARKETING/broadcast templates need an
 *    explicit MARKETING opt-in (form checkbox, Lead Ad, manager attestation, START keyword...). No record = NOT eligible.
 *  - An opt-out is never undone by an ordinary message; only an explicit opt-in (START keyword, attestation) re-subscribes.
 *  - Opt-outs survive lead erasure as a tenant-salted phone hash (`consent_suppressions`), so a re-added number starts opted out.
 */
import { createHash } from 'node:crypto';
import type { Prisma, TxClient } from '@leadpilot/database';
import { v7 as uuidv7 } from 'uuid';

export type ConsentDisposition = 'ELIGIBLE' | 'OPTED_OUT' | 'NO_CONSENT';
export type ConsentPurposeKey = 'TRANSACTIONAL' | 'SERVICE' | 'MARKETING';
export type ConsentMethodKey =
  | 'INBOUND_MESSAGE' | 'STOP_KEYWORD' | 'START_KEYWORD' | 'FORM_CHECKBOX' | 'META_LEAD_AD' | 'MANAGER_ATTESTED'
  | 'CSV_IMPORT' | 'API' | 'PORTAL' | 'WIDGET' | 'UNSUBSCRIBE_LINK';
export type ConsentActorKey = 'CUSTOMER' | 'MEMBER' | 'SYSTEM' | 'IMPORT';

export const WHATSAPP = 'whatsapp';

/** Legacy status-only helper, kept for existing callers: eligibility from the newest row's status alone. */
export function consentDisposition(latest: string | undefined): ConsentDisposition {
  if (latest === 'OPTED_IN') return 'ELIGIBLE';
  if (latest === 'OPTED_OUT') return 'OPTED_OUT';
  return 'NO_CONSENT';
}

/** Latest consent status per lead from rows ordered newest first. */
export function latestConsentByLead(rows: ReadonlyArray<{ leadId: string; status: string }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.leadId)) out.set(r.leadId, r.status);
  return out;
}

export interface LedgerRow { status: string; purpose: string; expiresAt?: Date | null }

/**
 * Pure decision for ONE lead. `rows` are that lead's consent rows, newest first. `suppressed` = the phone is on the erasure suppression list.
 * Rows whose `expiresAt` has passed are ignored (an expired opt-in is no opt-in; an opt-out never expires).
 */
export function evaluateConsent(rows: readonly LedgerRow[], purpose: ConsentPurposeKey, suppressed = false, now: Date = new Date()): ConsentDisposition {
  const live = rows.filter((r) => r.status === 'OPTED_OUT' || !r.expiresAt || r.expiresAt.getTime() > now.getTime());
  const latest = live[0];
  if (!latest) return suppressed ? 'OPTED_OUT' : 'NO_CONSENT';
  if (latest.status === 'OPTED_OUT') return 'OPTED_OUT';
  if (purpose !== 'MARKETING') return 'ELIGIBLE';
  for (const r of live) {
    if (r.status === 'OPTED_OUT') break;
    if (r.purpose === 'MARKETING') return 'ELIGIBLE';
  }
  return 'NO_CONSENT';
}

/** sha256(`${tenantId}:${phoneNorm}`): must match the expression in the erase_lead() SQL function. */
export function phoneSuppressionHash(tenantId: string, phoneNorm: string): string {
  return createHash('sha256').update(`${tenantId}:${phoneNorm}`, 'utf8').digest('hex');
}

export interface LeadRef { id: string; phoneNorm: string | null }

/** Dispositions for many leads at once (campaign audiences, up to a few thousand). */
export async function consentDispositions(tx: TxClient, tenantId: string, leads: readonly LeadRef[], purpose: ConsentPurposeKey): Promise<Map<string, ConsentDisposition>> {
  const out = new Map<string, ConsentDisposition>();
  if (leads.length === 0) return out;
  const rows = await tx.consent.findMany({
    where: { tenantId, channel: WHATSAPP, leadId: { in: leads.map((l) => l.id) } },
    orderBy: { createdAt: 'desc' },
    select: { leadId: true, status: true, purpose: true, expiresAt: true },
  });
  const byLead = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    const list = byLead.get(r.leadId);
    if (list) list.push(r); else byLead.set(r.leadId, [r]);
  }
  const noRows = leads.filter((l) => !byLead.has(l.id) && l.phoneNorm);
  const hashes = new Map(noRows.map((l) => [phoneSuppressionHash(tenantId, l.phoneNorm as string), l.id] as const));
  const suppressedLeads = new Set<string>();
  if (hashes.size > 0) {
    const hit = await tx.consentSuppression.findMany({ where: { tenantId, channel: WHATSAPP, phoneHash: { in: [...hashes.keys()] } }, select: { phoneHash: true } });
    for (const h of hit) { const id = hashes.get(h.phoneHash); if (id) suppressedLeads.add(id); }
  }
  for (const l of leads) out.set(l.id, evaluateConsent(byLead.get(l.id) ?? [], purpose, suppressedLeads.has(l.id)));
  return out;
}

export async function consentDispositionFor(tx: TxClient, tenantId: string, lead: LeadRef, purpose: ConsentPurposeKey): Promise<ConsentDisposition> {
  return (await consentDispositions(tx, tenantId, [lead], purpose)).get(lead.id) ?? 'NO_CONSENT';
}

/** Same as consentDispositionFor when only the lead id is at hand (looks up the phone for the erasure suppression check). */
export async function consentDispositionById(tx: TxClient, tenantId: string, leadId: string, purpose: ConsentPurposeKey): Promise<ConsentDisposition> {
  const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId }, select: { phoneNorm: true } });
  return consentDispositionFor(tx, tenantId, { id: leadId, phoneNorm: lead?.phoneNorm ?? null }, purpose);
}

/** True when a marketing opt-in was recorded. Never overrides an opt-out and adds no row when the lead is already eligible. */
export async function grantMarketingConsentIfAllowed(tx: TxClient, input: Omit<RecordConsentInput, 'status' | 'purpose'>): Promise<boolean> {
  const state = await consentDispositionById(tx, input.tenantId, input.leadId, 'MARKETING');
  if (state !== 'NO_CONSENT') return false;
  await recordConsent(tx, { ...input, status: 'OPTED_IN', purpose: 'MARKETING' });
  return true;
}

export interface RecordConsentInput {
  tenantId: string;
  leadId: string;
  status: 'OPTED_IN' | 'OPTED_OUT';
  purpose: ConsentPurposeKey;
  method: ConsentMethodKey;
  actorType: ConsentActorKey;
  actorUserId?: string | null;
  actorMembershipId?: string | null;
  /** Back-compat free-text source (also searchable in old reports). Defaults to the lower-cased method. */
  source?: string;
  textVersion?: string | null;
  evidence?: Record<string, unknown> | null;
  expiresAt?: Date | null;
  channel?: string;
}

/**
 * The only writer of consent rows. Appends the ledger row, a lead timeline entry and an audit row in the caller's transaction.
 * Evidence must never contain secrets; keep it to IP, user agent, page URL, import batch id, attestation basis and reason.
 */
export async function recordConsent(tx: TxClient, i: RecordConsentInput): Promise<{ id: string }> {
  const id = uuidv7();
  const channel = i.channel ?? WHATSAPP;
  await tx.consent.create({
    data: {
      id, tenantId: i.tenantId, leadId: i.leadId, channel, status: i.status, source: i.source ?? i.method.toLowerCase(),
      purpose: i.purpose, method: i.method, actorType: i.actorType, actorMembershipId: i.actorMembershipId ?? null,
      textVersion: i.textVersion ?? null, evidence: (i.evidence ?? undefined) as Prisma.InputJsonValue | undefined, expiresAt: i.expiresAt ?? null,
    },
  });
  await tx.leadActivity.create({
    data: {
      id: uuidv7(), tenantId: i.tenantId, leadId: i.leadId, type: 'consent_changed', actorUserId: i.actorUserId ?? null,
      data: { channel, status: i.status, purpose: i.purpose, method: i.method },
    },
  });
  await tx.auditLog.createMany({
    data: [{
      tenantId: i.tenantId, actorUserId: i.actorUserId ?? null, action: i.status === 'OPTED_IN' ? 'consent.opted_in' : 'consent.opted_out',
      resourceType: 'lead', resourceId: i.leadId, metadata: { channel, purpose: i.purpose, method: i.method, consentId: id },
    }],
  });
  return { id };
}
