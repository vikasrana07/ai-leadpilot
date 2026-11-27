import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import crypto from 'node:crypto';
import type { Actor } from '../../common/actor.js';
import { ENV } from '../../common/tokens.js';
import type { Env } from '../../config/env.js';
import { SecretBox } from '../../crypto/secret-box.js';
import { DbService } from '../../db/db.module.js';
import { LeadsService } from '../../leads/leads.service.js';

export interface SheetColumnMapping {
  name?: string;
  phone?: string;
  email?: string;
  location?: string;
  requirements?: string;
}

export interface MappedSheetLead {
  name: string;
  phone?: string;
  email?: string;
  location?: string;
  requirements?: string;
}

export function mapSheetRowsToLeads(
  headers: string[],
  rows: string[][],
  mapping: SheetColumnMapping,
): MappedSheetLead[] {
  const colIdx = (col?: string) => {
    if (!col) return -1;
    const norm = col.trim().toLowerCase();
    return headers.findIndex((h) => h.trim().toLowerCase() === norm);
  };

  const iName = colIdx(mapping.name ?? 'Name');
  const iPhone = colIdx(mapping.phone ?? 'Phone');
  const iEmail = colIdx(mapping.email ?? 'Email');
  const iLoc = colIdx(mapping.location ?? 'Location');
  const iReq = colIdx(mapping.requirements ?? 'Notes');

  const out: MappedSheetLead[] = [];
  for (const row of rows) {
    const phone = iPhone >= 0 ? row[iPhone]?.trim() : undefined;
    const email = iEmail >= 0 ? row[iEmail]?.trim() : undefined;
    if (!phone && !email) continue;
    const name = (iName >= 0 ? row[iName]?.trim() : undefined) || 'Google Sheet Lead';
    const location = iLoc >= 0 ? row[iLoc]?.trim() : undefined;
    const requirements = iReq >= 0 ? row[iReq]?.trim() : undefined;
    out.push({
      name: name.slice(0, 120),
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      ...(location ? { location: location.slice(0, 120) } : {}),
      ...(requirements ? { requirements: requirements.slice(0, 1000) } : {}),
    });
  }
  return out;
}

@Injectable()
export class GoogleSheetsService {
  private readonly log = new Logger('GoogleSheets');

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(SecretBox) private readonly box: SecretBox,
    @Inject(LeadsService) private readonly leads: LeadsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private signState(tenantId: string): string {
    const payload = Buffer.from(JSON.stringify({ tenantId, iat: Date.now() })).toString('base64url');
    const sig = crypto.createHmac('sha256', this.env.JWT_ACCESS_SECRET).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  private verifyState(state: string, tenantId: string): void {
    const [payload, sig] = state.split('.');
    if (!payload || !sig) throw new BadRequestException({ code: 'invalid_state', message: 'Invalid OAuth state' });
    const expected = crypto.createHmac('sha256', this.env.JWT_ACCESS_SECRET).update(payload).digest('base64url');
    if (sig !== expected) throw new BadRequestException({ code: 'invalid_state', message: 'Invalid OAuth state' });
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { tenantId: string; iat: number };
    if (parsed.tenantId !== tenantId || Date.now() - parsed.iat > 15 * 60_000) {
      throw new BadRequestException({ code: 'invalid_state', message: 'OAuth state expired' });
    }
  }

  async getStatus(tenantId: string) {
    const sync = await this.db.tenantTx({ tenantId }, (tx) =>
      tx.googleSheetSync.findUnique({ where: { tenantId } }),
    );
    if (!sync) return { connected: false, configured: false };
    return {
      connected: true,
      configured: Boolean(sync.spreadsheetId),
      spreadsheetId: sync.spreadsheetId,
      spreadsheetName: sync.spreadsheetName,
      sheetName: sync.sheetName,
      columnMapping: sync.columnMapping as SheetColumnMapping,
      lastSyncedRow: sync.lastSyncedRow,
      enabled: sync.enabled,
      lastSyncedAt: sync.lastSyncedAt?.toISOString() ?? null,
      lastError: sync.lastError,
    };
  }

  getAuthUrl(tenantId: string): string {
    if (!this.env.GOOGLE_CALENDAR_CLIENT_ID) {
      throw new ServiceUnavailableException({ code: 'google_not_configured', message: 'Google OAuth is not configured' });
    }
    const redirectUri = `${this.env.WEB_ORIGIN}/integrations?gsheets=callback`;
    const params = new URLSearchParams({
      client_id: this.env.GOOGLE_CALENDAR_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/userinfo.email',
      access_type: 'offline',
      prompt: 'consent',
      state: this.signState(tenantId),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async connect(tenantId: string, code: string, state: string) {
    this.verifyState(state, tenantId);
    if (!this.env.GOOGLE_CALENDAR_CLIENT_ID || !this.env.GOOGLE_CALENDAR_CLIENT_SECRET) {
      throw new ServiceUnavailableException({ code: 'google_not_configured', message: 'Google OAuth is not configured' });
    }
    const redirectUri = `${this.env.WEB_ORIGIN}/integrations?gsheets=callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.env.GOOGLE_CALENDAR_CLIENT_ID,
        client_secret: this.env.GOOGLE_CALENDAR_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      throw new BadRequestException({ code: 'oauth_failed', message: 'Could not exchange Google authorization code' });
    }
    const tokens = (await tokenRes.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    const sealed = await this.box.seal(
      {
        access_token: tokens.access_token,
        ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      },
      tenantId,
    );

    await this.db.tenantTx({ tenantId }, async (tx) => {
      const cred = await tx.integrationCredential.create({
        data: {
          tenantId,
          provider: 'google_sheets',
          ciphertext: sealed.ciphertext,
          wrappedKey: sealed.wrappedKey,
          keyId: sealed.keyId,
          status: 'active',
        },
      });
      await tx.googleSheetSync.upsert({
        where: { tenantId },
        create: { tenantId, credentialId: cred.id, enabled: false },
        update: { credentialId: cred.id, lastError: null },
      });
    });
    return { ok: true };
  }

  async configure(
    tenantId: string,
    input: { spreadsheetId: string; spreadsheetName?: string; sheetName: string; columnMapping: SheetColumnMapping; enabled: boolean },
  ) {
    const sync = await this.db.tenantTx({ tenantId }, async (tx) => {
      const existing = await tx.googleSheetSync.findUnique({ where: { tenantId } });
      if (!existing) throw new BadRequestException({ code: 'not_connected', message: 'Connect Google Sheets first' });
      const resetCursor = existing.spreadsheetId !== input.spreadsheetId || existing.sheetName !== input.sheetName;
      return tx.googleSheetSync.update({
        where: { tenantId },
        data: {
          spreadsheetId: input.spreadsheetId,
          spreadsheetName: input.spreadsheetName ?? null,
          sheetName: input.sheetName,
          columnMapping: input.columnMapping as Record<string, string>,
          enabled: input.enabled,
          ...(resetCursor ? { lastSyncedRow: 1 } : {}),
          lastError: null,
        },
      });
    });
    return { ok: true, spreadsheetId: sync.spreadsheetId, sheetName: sync.sheetName, enabled: sync.enabled };
  }

  async syncNow(tenantId: string): Promise<{ imported: number; lastSyncedRow: number }> {
    const row = await this.db.tenantTx({ tenantId }, async (tx) => {
      const sync = await tx.googleSheetSync.findUnique({ where: { tenantId } });
      if (!sync || !sync.spreadsheetId) {
        throw new BadRequestException({ code: 'not_configured', message: 'Configure a spreadsheet first' });
      }
      const cred = await tx.integrationCredential.findFirst({ where: { id: sync.credentialId, tenantId } });
      if (!cred) throw new BadRequestException({ code: 'not_connected', message: 'Google credentials missing' });
      return { sync, cred };
    });

    const tokens = await this.box.open(
      {
        ciphertext: row.cred.ciphertext,
        wrappedKey: row.cred.wrappedKey,
        keyId: row.cred.keyId,
      },
      tenantId,
    );

    const range = encodeURIComponent(`${row.sync.sheetName}!A1:Z`);
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(row.sync.spreadsheetId!)}/values/${range}`, {
      headers: { Authorization: `Bearer ${tokens.access_token ?? ''}` },
    });
    if (!res.ok) {
      const msg = `Google Sheets API error (${res.status})`;
      await this.db.tenantTx({ tenantId }, (tx) => tx.googleSheetSync.update({ where: { tenantId }, data: { lastError: msg } }));
      throw new BadRequestException({ code: 'sheets_fetch_failed', message: msg });
    }

    const data = (await res.json()) as { values?: string[][] };
    const allRows = data.values ?? [];
    if (allRows.length <= row.sync.lastSyncedRow) {
      await this.db.tenantTx({ tenantId }, (tx) =>
        tx.googleSheetSync.update({ where: { tenantId }, data: { lastSyncedAt: new Date(), lastError: null } }),
      );
      return { imported: 0, lastSyncedRow: row.sync.lastSyncedRow };
    }

    const headers = allRows[0] ?? [];
    const newRows = allRows.slice(row.sync.lastSyncedRow);
    const mapped = mapSheetRowsToLeads(headers, newRows, row.sync.columnMapping as SheetColumnMapping);
    const actor: Actor = {
      tenantId,
      userId: null,
      membershipId: null,
      permissions: new Set(['lead:write:all', 'lead:assign']),
      requestId: undefined,
      ip: undefined,
    };

    let imported = 0;
    for (const item of mapped) {
      try {
        await this.leads.create(actor, {
          name: item.name,
          phone: item.phone ?? null,
          email: item.email ?? null,
          location: item.location ?? null,
          propertyType: null,
          requirements: item.requirements ?? null,
          sourceKey: 'google_sheets',
        });
        imported++;
      } catch (e) {
        this.log.warn(`Skipping sheet row: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }

    const nextRow = allRows.length;
    await this.db.tenantTx({ tenantId }, (tx) =>
      tx.googleSheetSync.update({
        where: { tenantId },
        data: { lastSyncedRow: nextRow, lastSyncedAt: new Date(), lastError: null },
      }),
    );
    return { imported, lastSyncedRow: nextRow };
  }

  async disconnect(tenantId: string): Promise<void> {
    await this.db.tenantTx({ tenantId }, async (tx) => {
      const sync = await tx.googleSheetSync.findUnique({ where: { tenantId } });
      if (sync) {
        await tx.googleSheetSync.delete({ where: { tenantId } });
        await tx.integrationCredential.deleteMany({ where: { id: sync.credentialId, tenantId } });
      }
    });
  }
}
