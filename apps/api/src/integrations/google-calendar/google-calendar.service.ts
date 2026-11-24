import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { TxClient } from '@leadpilot/database';
import { v7 as uuidv7 } from 'uuid';
import { DbService } from '../../db/db.module.js';
import { ENV } from '../../common/tokens.js';
import type { Env } from '../../config/env.js';
import { SecretBox } from '../../crypto/secret-box.js';
import type { Busy } from '../../ops/availability.js';

export interface GoogleCalendarTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: string;
}

export interface GoogleCalendarStatus {
  mode: 'off' | 'mock' | 'live';
  connected: boolean;
  email: string | null;
  calendarId: string | null;
  lastSyncedAt: string | null;
  status: string | null;
}

/** The member's Google connection can no longer be used (revoked/expired grant): retrying cannot help, only reconnecting does. */
export class GoogleReauthRequired extends Error {}

/** Refresh a little before expiry so a token never lapses mid-request. */
const TOKEN_REFRESH_SKEW_MS = 60_000;
/** The columns of a calendar connection that the Google helpers need. */
type SyncRef = { id: string; credentialId: string; calendarId: string; membershipId: string };
const STATE_TTL_MS = 10 * 60_000;
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

@Injectable()
export class GoogleCalendarService {
  private readonly log = new Logger('GoogleCalendar');

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(SecretBox) private readonly box: SecretBox,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private aad(tenantId: string): string {
    return `tenant:${tenantId}:google_calendar`;
  }

  get mode(): Env['GOOGLE_CALENDAR_MODE'] {
    return this.env.GOOGLE_CALENDAR_MODE;
  }

  /**
   * Returns current sync status for a team member's Google Calendar.
   */
  /** True when the integration is switched on (mock or live). */
  isEnabled(): boolean {
    return this.mode !== 'off';
  }

  async getStatus(tenantId: string, membershipId: string): Promise<GoogleCalendarStatus> {
    if (this.mode === 'off') {
      return { mode: 'off', connected: false, email: null, calendarId: null, lastSyncedAt: null, status: null };
    }

    return this.db.tenantTx({ tenantId }, async (tx) => {
      const sync = await tx.googleCalendarSync.findUnique({
        where: { tenantId_membershipId: { tenantId, membershipId } },
      });

      if (!sync || sync.status === 'disconnected') {
        return { mode: this.mode, connected: false, email: null, calendarId: null, lastSyncedAt: null, status: null };
      }

      return {
        mode: this.mode,
        connected: sync.status === 'active',
        email: sync.email,
        calendarId: sync.calendarId,
        lastSyncedAt: sync.lastSyncedAt?.toISOString() ?? null,
        status: sync.status,
      };
    });
  }

  /** The redirect URI is fixed by configuration; it is never taken from the client. */
  private redirectUri(): string {
    return this.env.GOOGLE_CALENDAR_REDIRECT_URI ?? `${this.env.WEB_ORIGIN}/integrations`;
  }

  /** Domain-separated key so the session-signing secret is never used directly for OAuth state. */
  private stateKey(): Buffer {
    return createHmac('sha256', this.env.JWT_ACCESS_SECRET).update('leadpilot/google-calendar-oauth-state/v1').digest();
  }

  /** Stateless signed state bound to the workspace member that started the flow: `<payload>.<hmac>`, valid for 10 minutes. */
  private signState(tenantId: string, membershipId: string): string {
    const payload = Buffer.from(JSON.stringify({ t: tenantId, m: membershipId, n: randomBytes(16).toString('base64url'), e: Date.now() + STATE_TTL_MS })).toString('base64url');
    const sig = createHmac('sha256', this.stateKey()).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  private verifyState(state: string, tenantId: string, membershipId: string): void {
    const invalid = (): never => { throw new BadRequestException({ code: 'invalid_oauth_state', message: 'The Google sign-in request is invalid or has expired. Please start again.' }); };
    const [payload, sig, extra] = state.split('.');
    if (!payload || !sig || extra !== undefined) return invalid();
    const expected = createHmac('sha256', this.stateKey()).update(payload).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return invalid();
    let claims: { t?: string; m?: string; e?: number };
    try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof claims; } catch { return invalid(); }
    if (claims.t !== tenantId || claims.m !== membershipId || typeof claims.e !== 'number' || claims.e < Date.now()) return invalid();
  }

  /**
   * Generates the OAuth2 consent URL for the sales agent to link their Google Calendar.
   */
  getAuthUrl(tenantId: string, membershipId: string): string {
    if (this.mode === 'off') {
      throw new BadRequestException({ code: 'gcal_disabled', message: 'Google Calendar integration is disabled' });
    }

    const state = this.signState(tenantId, membershipId);
    const redirect = this.redirectUri();

    if (this.mode === 'mock') {
      // In mock mode, redirect back with a mock code so local development and testing are seamless
      return `${redirect}?gcal_mock=1&code=mock_code_${membershipId}&state=${state}`;
    }

    const clientId = this.env.GOOGLE_CALENDAR_CLIENT_ID;
    if (!clientId) {
      throw new BadRequestException({ code: 'gcal_not_configured', message: 'Google Calendar Client ID is not configured' });
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchanges authorization code and seals encrypted tokens in integration_credentials.
   */
  async connect(tenantId: string, membershipId: string, code: string, state: string): Promise<{ email: string }> {
    if (this.mode === 'off') {
      throw new BadRequestException({ code: 'gcal_disabled', message: 'Google Calendar integration is disabled' });
    }

    // OAuth login-CSRF guard: the state must have been issued by this server, for THIS workspace member, and not be expired.
    this.verifyState(state, tenantId, membershipId);

    let email = 'agent@example.com';
    let tokens: GoogleCalendarTokens;

    if (this.mode === 'mock') {
      tokens = {
        accessToken: `mock_access_token_${membershipId}`,
        refreshToken: `mock_refresh_token_${membershipId}`,
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      };
      email = `agent_${membershipId.slice(0, 6)}@example.com`;
    } else {
      const clientId = this.env.GOOGLE_CALENDAR_CLIENT_ID;
      const clientSecret = this.env.GOOGLE_CALENDAR_CLIENT_SECRET;
      const resolvedRedirect = this.redirectUri();

      if (!clientId || !clientSecret) {
        throw new BadRequestException({ code: 'gcal_not_configured', message: 'Google Calendar Client credentials missing' });
      }

      // 1. Exchange code for tokens
      try {
        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: resolvedRedirect,
          }).toString(),
          signal: AbortSignal.timeout(10_000),
        });

        if (!tokenRes.ok) {
          const errText = await tokenRes.text();
          throw new Error(`Google token exchange failed (${tokenRes.status}): ${errText}`);
        }

        const data = (await tokenRes.json()) as { access_token: string; refresh_token?: string; expires_in?: number; token_type?: string };
        tokens = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          tokenType: data.token_type,
          expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined,
        };
      } catch (err) {
        this.log.error(`Google token exchange error: ${err instanceof Error ? err.message : String(err)}`);
        throw new BadRequestException({ code: 'gcal_auth_failed', message: 'Could not connect Google Calendar' });
      }

      // 2. Fetch user's Google email
      try {
        const userRes = await fetch(GOOGLE_USERINFO_URL, {
          headers: { authorization: `Bearer ${tokens.accessToken}` },
          signal: AbortSignal.timeout(5_000),
        });
        if (userRes.ok) {
          const u = (await userRes.json()) as { email?: string };
          if (u.email) email = u.email;
        }
      } catch {
        // Fallback gracefully
      }
    }

    // 3. Seal tokens and persist
    return this.db.tenantTx({ tenantId }, async (tx) => {
      const tokenPayload: Record<string, string> = {
        accessToken: tokens.accessToken,
        ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
        ...(tokens.tokenType ? { tokenType: tokens.tokenType } : {}),
        ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
      };
      const sealed = await this.box.seal(tokenPayload, this.aad(tenantId));
      const existing = await tx.googleCalendarSync.findUnique({
        where: { tenantId_membershipId: { tenantId, membershipId } },
      });

      if (existing) {
        await tx.integrationCredential.update({
          where: { id: existing.credentialId },
          data: { ...sealed, status: 'active', lastVerifiedAt: new Date() },
        });
        await tx.googleCalendarSync.update({
          where: { id: existing.id },
          data: { status: 'active', email, lastSyncedAt: new Date() },
        });
      } else {
        const credId = uuidv7();
        await tx.integrationCredential.create({
          data: {
            id: credId,
            tenantId,
            provider: 'google_calendar',
            ...sealed,
            status: 'active',
            lastVerifiedAt: new Date(),
          },
        });
        await tx.googleCalendarSync.create({
          data: {
            id: uuidv7(),
            tenantId,
            membershipId,
            calendarId: 'primary',
            credentialId: credId,
            status: 'active',
            email,
            lastSyncedAt: new Date(),
          },
        });
      }

      return { email };
    });
  }

  /**
   * Disconnects a user's Google Calendar.
   */
  async disconnect(tenantId: string, membershipId: string): Promise<void> {
    await this.db.tenantTx({ tenantId }, async (tx) => {
      const sync = await tx.googleCalendarSync.findUnique({
        where: { tenantId_membershipId: { tenantId, membershipId } },
      });
      if (!sync) return;

      await tx.googleCalendarSync.delete({ where: { id: sync.id } });
      // The runtime role has no DELETE on integration_credentials (least privilege; only purge_tenant() removes rows). A failed DELETE would also
      // abort this whole Postgres transaction, silently rolling back the sync-row delete above. So revoke instead: overwrite the stored tokens
      // with an empty sealed payload so no refresh token is retained, and mark the credential revoked.
      const empty = await this.box.seal({}, this.aad(tenantId));
      await tx.integrationCredential.update({ where: { id: sync.credentialId }, data: { ...empty, status: 'revoked' } });
    });
  }

  /**
   * Queries Google Calendar Free/Busy for members with an active calendar connection.
   */
  async getFreeBusy(tenantId: string, membershipIds: string[], start: Date, end: Date): Promise<Busy[]> {
    if (this.mode === 'off' || membershipIds.length === 0) return [];

    return this.db.tenantTx({ tenantId }, async (tx) => {
      const syncs = await tx.googleCalendarSync.findMany({
        where: {
          tenantId,
          membershipId: { in: membershipIds },
          status: 'active',
        },
      });

      if (syncs.length === 0) return [];

      const out: Busy[] = [];

      for (const sync of syncs) {
        try {
          if (this.mode === 'mock') {
            // Mock mode returns clean empty or simulated busy slots if any
            continue;
          }

          // Live mode: Google Free/Busy API with a refreshed token when needed
          const res = await this.callGoogle(tx, tenantId, sync, (token) => fetch(`${GOOGLE_CALENDAR_API}/freeBusy`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ timeMin: start.toISOString(), timeMax: end.toISOString(), items: [{ id: sync.calendarId || 'primary' }] }),
            signal: AbortSignal.timeout(5000),
          }));

          if (res.ok) {
            const data = (await res.json()) as { calendars?: Record<string, { busy?: { start: string; end: string }[] }> };
            const busyList = data.calendars?.[sync.calendarId || 'primary']?.busy ?? [];
            for (const b of busyList) {
              out.push({
                membershipId: sync.membershipId,
                startsAt: new Date(b.start),
                endsAt: new Date(b.end),
              });
            }
          }
        } catch (e) {
          this.log.warn(`Could not fetch Google Calendar FreeBusy for ${sync.membershipId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      return out;
    });
  }

  /**
   * Synchronizes an appointment to Google Calendar (Insert, Update, or Delete).
   */
  async syncAppointment(
    tx: TxClient,
    tenantId: string,
    appointmentId: string,
    action: 'created' | 'rescheduled' | 'cancelled',
    opts: { strict?: boolean } = {},
  ): Promise<void> {
    if (this.mode === 'off') return;
    // Serialise syncs of one appointment (two relays, or a retry racing a newer event) so googleEventId is never created twice.
    await tx.$queryRaw`SELECT 1 FROM appointments WHERE id = ${appointmentId}::uuid FOR UPDATE`;

    const apt = await tx.appointment.findFirst({
      where: { id: appointmentId, tenantId },
    });
    if (!apt) return;

    const sync = await tx.googleCalendarSync.findUnique({
      where: { tenantId_membershipId: { tenantId, membershipId: apt.membershipId } },
    });
    if (!sync || sync.status !== 'active') return;

    if (action === 'cancelled' || apt.status === 'CANCELLED') {
      if (apt.googleEventId) {
        if (this.mode === 'live') {
          try {
            await this.deleteGoogleEvent(tx, tenantId, sync, apt.googleEventId);
          } catch (e) {
            if (e instanceof GoogleReauthRequired) { this.log.warn(`Google Calendar needs reconnecting; event for appointment ${apt.id} not removed`); return; }
            if (opts.strict) throw e; // the outbox relay retries with backoff
            this.log.error(`Failed to remove Google event for appointment ${apt.id}: ${e instanceof Error ? e.message : String(e)}`);
            return;
          }
        }
        await tx.appointment.update({
          where: { id: apt.id },
          data: { googleEventId: null },
        });
      }
      return;
    }

    // Created or Rescheduled
    const lead = await tx.lead.findUnique({ where: { id: apt.leadId }, select: { name: true, phone: true } });
    const description = [
      `Lead: ${lead?.name ?? 'Unknown'}`,
      lead?.phone ? `Phone: ${lead.phone}` : null,
      apt.notes ? `Notes: ${apt.notes}` : null,
      `Managed via LeadPilot AI`,
    ]
      .filter(Boolean)
      .join('\n');

    const eventPayload = {
      summary: apt.title,
      description,
      location: apt.location ?? undefined,
      start: { dateTime: apt.startsAt.toISOString() },
      end: { dateTime: apt.endsAt.toISOString() },
    };

    if (this.mode === 'mock') {
      const mockEventId = apt.googleEventId ?? `gcal_event_${apt.id.slice(0, 8)}`;
      await tx.appointment.update({
        where: { id: apt.id },
        data: { googleEventId: mockEventId },
      });
      return;
    }

    // Live mode
    try {
      if (apt.googleEventId) {
        await this.patchGoogleEvent(tx, tenantId, sync, apt.googleEventId, eventPayload);
      } else {
        const newEventId = await this.insertGoogleEvent(tx, tenantId, sync, eventPayload);
        if (newEventId) {
          await tx.appointment.update({
            where: { id: apt.id },
            data: { googleEventId: newEventId },
          });
        }
      }
    } catch (e) {
      if (e instanceof GoogleReauthRequired) { this.log.warn(`Google Calendar needs reconnecting; appointment ${apt.id} not pushed`); return; }
      if (opts.strict) throw e; // the outbox relay retries with backoff
      this.log.error(`Failed to push appointment ${apt.id} to Google Calendar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Returns a valid access token for a connection, refreshing it first when it is expired or about to expire. Everything runs on the
   * caller's tenant transaction: `integration_credentials` is RLS-protected, so reading it through the bare Prisma client (no tenant
   * context) finds nothing. A revoked or invalid refresh token marks the connection `needs_reauth` so the UI can ask the user to reconnect.
   */
  private async accessToken(tx: TxClient, tenantId: string, sync: SyncRef, forceRefresh = false): Promise<string> {
    const cred = await tx.integrationCredential.findUnique({ where: { id: sync.credentialId } });
    if (!cred) throw new Error('Google Calendar credential is missing');
    const tokens = (await this.box.open({ ciphertext: cred.ciphertext, wrappedKey: cred.wrappedKey, keyId: cred.keyId }, this.aad(tenantId))) as unknown as GoogleCalendarTokens;
    const expiresSoon = !tokens.expiresAt || Date.parse(tokens.expiresAt) - Date.now() < TOKEN_REFRESH_SKEW_MS;
    if (tokens.accessToken && !expiresSoon && !forceRefresh) return tokens.accessToken;

    if (!tokens.refreshToken) {
      await this.markNeedsReauth(tx, sync);
      throw new GoogleReauthRequired('Google Calendar needs to be reconnected (no refresh token)');
    }
    const clientId = this.env.GOOGLE_CALENDAR_CLIENT_ID;
    const clientSecret = this.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Google Calendar client credentials missing');

    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: tokens.refreshToken, grant_type: 'refresh_token' }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body.error === 'invalid_grant' || res.status === 401) {
        await this.markNeedsReauth(tx, sync); // the user revoked access or the token was invalidated: only reconnecting helps
        throw new GoogleReauthRequired('Google Calendar access was revoked; the member needs to reconnect');
      }
      throw new Error(`Google token refresh failed (${res.status})`); // transient: try again next time
    }
    const data = (await res.json()) as { access_token: string; expires_in?: number; refresh_token?: string; scope?: string; token_type?: string };
    const next: GoogleCalendarTokens = {
      ...tokens,
      accessToken: data.access_token,
      // Google normally keeps the same refresh token; keep ours unless a new one is issued
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
    };
    const sealed = await this.box.seal(Object.fromEntries(Object.entries(next).filter((e): e is [string, string] => typeof e[1] === 'string')), this.aad(tenantId));
    await tx.integrationCredential.update({ where: { id: sync.credentialId }, data: { ...sealed, lastVerifiedAt: new Date() } });
    return next.accessToken;
  }

  private async markNeedsReauth(tx: TxClient, sync: SyncRef): Promise<void> {
    await tx.googleCalendarSync.update({ where: { id: sync.id }, data: { status: 'needs_reauth' } });
  }

  /** Calls a Google API with a valid token; on a 401 it refreshes once and retries (access tokens can be revoked before they expire). */
  private async callGoogle(tx: TxClient, tenantId: string, sync: SyncRef, request: (token: string) => Promise<Response>): Promise<Response> {
    const res = await request(await this.accessToken(tx, tenantId, sync));
    if (res.status !== 401) return res;
    return request(await this.accessToken(tx, tenantId, sync, true));
  }

  private async insertGoogleEvent(tx: TxClient, tenantId: string, sync: SyncRef, payload: unknown): Promise<string | null> {
    const res = await this.callGoogle(tx, tenantId, sync, (token) => fetch(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(sync.calendarId)}/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    }));
    if (!res.ok) {
      throw new Error(`Google Calendar insert failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  }

  private async patchGoogleEvent(tx: TxClient, tenantId: string, sync: SyncRef, eventId: string, payload: unknown): Promise<void> {
    const res = await this.callGoogle(tx, tenantId, sync, (token) => fetch(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(sync.calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    }));
    if (!res.ok) {
      throw new Error(`Google Calendar patch failed (${res.status}): ${await res.text()}`);
    }
  }

  private async deleteGoogleEvent(tx: TxClient, tenantId: string, sync: SyncRef, eventId: string): Promise<void> {
    const res = await this.callGoogle(tx, tenantId, sync, (token) => fetch(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(sync.calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    }));
    if (!res.ok && res.status !== 404 && res.status !== 410) { // already gone is fine
      throw new Error(`Google Calendar delete failed (${res.status})`);
    }
  }
}
