/**
 * WhatsApp marketing eligibility (audit S-01). Business-initiated marketing templates require an explicit opt-in:
 * a lead with no consent record is NOT eligible. A later STOP always wins over an earlier opt-in.
 *
 * `latest` is the status of the lead's most recent `whatsapp` consent row, or undefined when there is none.
 */
export type ConsentDisposition = 'ELIGIBLE' | 'OPTED_OUT' | 'NO_CONSENT';

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
