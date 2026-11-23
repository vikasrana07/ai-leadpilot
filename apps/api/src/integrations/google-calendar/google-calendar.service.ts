import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

  /**
   * Generates the OAuth2 consent URL for the sales agent to link their Google Calendar.
   */
  getAuthUrl(tenantId: string, membershipId: string, redirectUri?: string): string {
    if (this.mode === 'off') {
      throw new BadRequestException({ code: 'gcal_disabled', message: 'Google Calendar integration is disabled' });
    }

    const state = Buffer.from(JSON.stringify({ tenantId, membershipId, ts: Date.now() })).toString('base64url');

    if (this.mode === 'mock') {
      // In mock mode, redirect back with a mock code so local development and testing are seamless
      const redirect = redirectUri ?? `${this.env.WEB_ORIGIN}/integrations`;
      return `${redirect}?gcal_mock=1&code=mock_code_${membershipId}&state=${state}`;
    }

    const clientId = this.env.GOOGLE_CALENDAR_CLIENT_ID;
    const resolvedRedirect = redirectUri ?? this.env.GOOGLE_CALENDAR_REDIRECT_URI ?? `${this.env.WEB_ORIGIN}/integrations`;

    if (!clientId) {
      throw new BadRequestException({ code: 'gcal_not_configured', message: 'Google Calendar Client ID is not configured' });
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: resolvedRedirect,
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
  async connect(tenantId: string, membershipId: string, code: string, redirectUri?: string): Promise<{ email: string }> {
    if (this.mode === 'off') {
      throw new BadRequestException({ code: 'gcal_disabled', message: 'Google Calendar integration is disabled' });
    }

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
      const resolvedRedirect = redirectUri ?? this.env.GOOGLE_CALENDAR_REDIRECT_URI ?? `${this.env.WEB_ORIGIN}/integrations`;

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
      await tx.integrationCredential.delete({ where: { id: sync.credentialId } }).catch(() => null);
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

          // Live mode: decrypt tokens, call Google Free/Busy API
          const cred = await tx.integrationCredential.findUnique({ where: { id: sync.credentialId } });
          if (!cred) continue;

          const tokens = (await this.box.open(
            { ciphertext: cred.ciphertext, wrappedKey: cred.wrappedKey, keyId: cred.keyId },
            this.aad(tenantId),
          )) as unknown as GoogleCalendarTokens;

          const res = await fetch(`${GOOGLE_CALENDAR_API}/freeBusy`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${tokens.accessToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              timeMin: start.toISOString(),
              timeMax: end.toISOString(),
              items: [{ id: sync.calendarId || 'primary' }],
            }),
            signal: AbortSignal.timeout(5000),
          });

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
  ): Promise<void> {
    if (this.mode === 'off') return;

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
          await this.deleteGoogleEvent(tenantId, sync, apt.googleEventId);
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
        await this.patchGoogleEvent(tenantId, sync, apt.googleEventId, eventPayload);
      } else {
        const newEventId = await this.insertGoogleEvent(tenantId, sync, eventPayload);
        if (newEventId) {
          await tx.appointment.update({
            where: { id: apt.id },
            data: { googleEventId: newEventId },
          });
        }
      }
    } catch (e) {
      this.log.error(`Failed to push appointment ${apt.id} to Google Calendar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async getDecryptedTokens(tenantId: string, sync: { credentialId: string }): Promise<GoogleCalendarTokens> {
    const cred = await this.db.prisma.integrationCredential.findUniqueOrThrow({ where: { id: sync.credentialId } });
    return (await this.box.open(
      { ciphertext: cred.ciphertext, wrappedKey: cred.wrappedKey, keyId: cred.keyId },
      this.aad(tenantId),
    )) as unknown as GoogleCalendarTokens;
  }

  private async insertGoogleEvent(tenantId: string, sync: { credentialId: string; calendarId: string }, payload: unknown): Promise<string | null> {
    const tokens = await this.getDecryptedTokens(tenantId, sync);
    const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(sync.calendarId)}/events`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      throw new Error(`Google Calendar insert failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  }

  private async patchGoogleEvent(tenantId: string, sync: { credentialId: string; calendarId: string }, eventId: string, payload: unknown): Promise<void> {
    const tokens = await this.getDecryptedTokens(tenantId, sync);
    const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(sync.calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      throw new Error(`Google Calendar patch failed (${res.status}): ${await res.text()}`);
    }
  }

  private async deleteGoogleEvent(tenantId: string, sync: { credentialId: string; calendarId: string }, eventId: string): Promise<void> {
    const tokens = await this.getDecryptedTokens(tenantId, sync);
    await fetch(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(sync.calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
  }
}
