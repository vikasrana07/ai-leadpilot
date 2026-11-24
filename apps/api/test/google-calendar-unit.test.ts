import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleCalendarService } from '../src/integrations/google-calendar/google-calendar.service.js';
import { SecretBox } from '../src/crypto/secret-box.js';
import type { Env } from '../src/config/env.js';

describe('GoogleCalendarService unit tests', () => {
  const masterKey = Buffer.alloc(32, 1).toString('base64');

  const mockEnv: Env = {
    LOCAL_MASTER_KEY: masterKey,
    KEY_PROVIDER: 'local',
    JWT_ACCESS_SECRET: 'j'.repeat(48),
    GOOGLE_CALENDAR_MODE: 'mock',
    GOOGLE_CALENDAR_CLIENT_ID: 'test-client-id',
    GOOGLE_CALENDAR_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_CALENDAR_REDIRECT_URI: 'http://localhost:3100/integrations/google-calendar/callback',
  } as unknown as Env;

  const box = new SecretBox(mockEnv);

  const mockDbService = {} as any;

  it('generates an auth URL for OAuth connection with state', () => {
    const service = new GoogleCalendarService(mockDbService, box, mockEnv);
    const auth = service.getAuthUrl('t1', 'm1');
    expect(auth).toContain('gcal_mock=1');
    expect(auth).toContain('state=');
  });

  it('generates live OAuth URL when mode is live', () => {
    const liveEnv: Env = {
      ...mockEnv,
      GOOGLE_CALENDAR_MODE: 'live',
    } as unknown as Env;
    const service = new GoogleCalendarService(mockDbService, box, liveEnv);
    const auth = service.getAuthUrl('t1', 'm1');
    expect(auth).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(auth).toContain('client_id=test-client-id');
    expect(auth).toContain('scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar');
    expect(auth).toContain('state=');
  });

  describe('OAuth state', () => {
    afterEach(() => { vi.useRealTimers(); });
    const stateOf = (url: string) => new URL(url).searchParams.get('state') as string;

    it('is bound to the member and expires after 10 minutes', async () => {
      vi.useFakeTimers({ now: new Date('2026-11-24T10:00:00Z') });
      const service = new GoogleCalendarService(mockDbService, box, mockEnv);
      const state = stateOf(service.getAuthUrl('t1', 'm1'));
      await expect(service.connect('t1', 'm2', 'code', state)).rejects.toMatchObject({ response: { code: 'invalid_oauth_state' } }); // other member
      await expect(service.connect('t2', 'm1', 'code', state)).rejects.toMatchObject({ response: { code: 'invalid_oauth_state' } }); // other tenant
      vi.setSystemTime(new Date('2026-11-24T10:10:01Z'));
      await expect(service.connect('t1', 'm1', 'code', state)).rejects.toMatchObject({ response: { code: 'invalid_oauth_state' } }); // expired
    });

    it('is not accepted when signed with a different secret', async () => {
      const a = new GoogleCalendarService(mockDbService, box, mockEnv);
      const b = new GoogleCalendarService(mockDbService, box, { ...mockEnv, JWT_ACCESS_SECRET: 'k'.repeat(48) } as unknown as Env);
      await expect(b.connect('t1', 'm1', 'code', stateOf(a.getAuthUrl('t1', 'm1')))).rejects.toMatchObject({ response: { code: 'invalid_oauth_state' } });
    });

    it('does not let the caller choose the redirect URI', () => {
      const liveEnv = { ...mockEnv, GOOGLE_CALENDAR_MODE: 'live' } as unknown as Env;
      const url = new GoogleCalendarService(mockDbService, box, liveEnv).getAuthUrl('t1', 'm1');
      expect(new URL(url).searchParams.get('redirect_uri')).toBe('http://localhost:3100/integrations/google-calendar/callback');
    });
  });

  it('returns empty busy intervals when no memberships are given', async () => {
    const service = new GoogleCalendarService(mockDbService, box, mockEnv);
    const result = await service.getFreeBusy('t1', [], new Date(), new Date());
    expect(result).toEqual([]);
  });

  it('returns empty busy intervals in mock mode when no syncs exist', async () => {
    let queriedSync = false;
    const mockTx = {
      googleCalendarSync: {
        findMany: async () => {
          queriedSync = true;
          return [];
        },
      },
    } as any;

    const mockDbWithTx = {
      tenantTx: async (_ctx: any, fn: any) => fn(mockTx),
    } as any;

    const service = new GoogleCalendarService(mockDbWithTx, box, mockEnv);
    const start = new Date('2026-11-25T00:00:00.000Z');
    const end = new Date('2026-11-26T00:00:00.000Z');
    const busy = await service.getFreeBusy('t1', ['mem_1'], start, end);

    expect(queriedSync).toBe(true);
    expect(busy).toEqual([]);
  });

  it('seals and unseals OAuth tokens with tenant-bound AAD', async () => {
    const payload = {
      access_token: 'ya29.test_token',
      refresh_token: '1//refresh_test',
      expires_at: '1732380000000',
    };
    const aad = 'aad:t1:mem_1';
    const sealed = await box.seal(payload, aad);
    expect(sealed.ciphertext).not.toContain('ya29.test_token');

    const opened = await box.open(sealed, aad);
    expect(opened).toEqual(payload);
  });
});
