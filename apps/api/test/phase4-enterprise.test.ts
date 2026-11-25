import { describe, expect, it, vi } from 'vitest';
import { SsoService } from '../src/auth/sso.service.js';
import { AuditService } from '../src/audit/audit.service.js';
import { LifecycleJobs } from '../src/ops/lifecycle-jobs.js';

describe('Phase 4: Enterprise Readiness & Hardening', () => {
  describe('Enterprise SSO (OIDC & SAML 2.0)', () => {
    const env = {
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-chars-long',
      WEB_ORIGIN: 'http://localhost:3100',
    };

    it('initiates OIDC login and handles callback with JIT provisioning', async () => {
      const storedSettings: Record<string, unknown> = {
        sso: {
          enabled: true,
          provider: 'OIDC',
          autoProvision: true,
          defaultRole: 'agent',
          issuerUrl: 'https://idp.example.com',
          clientId: 'client-123',
          encryptedClientSecret: 'enc:secret',
        },
      };

      const txMock = {
        tenant: {
          findUnique: vi.fn().mockResolvedValue({ settings: storedSettings }),
        },
        user: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'u-new' }),
        },
        membership: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'm-new' }),
        },
        role: {
          findFirst: vi.fn().mockResolvedValue({ id: 'role-agent' }),
        },
      };

      const dbMock = {
        prisma: {
          tenant: {
            findFirst: vi.fn().mockResolvedValue({ id: 't-1', slug: 'acme', settings: storedSettings }),
          },
        },
        tenantTx: vi.fn().mockImplementation((_ctx, fn) => fn(txMock)),
      };

      const boxMock = {
        seal: vi.fn(async (v: Record<string, string>) => ({ ciphertext: v.clientSecret ?? '', wrappedKey: 'wk', keyId: 'k1' })),
        open: vi.fn(async (s: { ciphertext: string }) => ({ clientSecret: s.ciphertext })),
      };

      const auditMock = { record: vi.fn().mockResolvedValue({}) };
      const authMock = {
        issueSession: vi.fn().mockResolvedValue({
          accessToken: 'jwt-access',
          refreshToken: 'jwt-refresh',
          refreshExpiresAt: new Date(Date.now() + 86400_000),
          context: { user: { id: 'u-new', email: 'sso@acme.test' } },
        }),
      };

      const sso = new SsoService(dbMock as any, boxMock as any, auditMock as any, authMock as any, env as any);

      const init = await sso.initiateLogin({ tenantSlug: 'acme' });
      expect(init.provider).toBe('OIDC');
      expect(init.redirectUrl).toContain('https://idp.example.com/authorize');
      expect(init.state).toContain('.');

      const session = await sso.handleOidcCallback(
        { code: 'mock_code', state: init.state, mockClaims: { email: 'sso@acme.test', name: 'SSO User' } },
        { ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-1' },
      );

      expect(session.accessToken).toBe('jwt-access');
      expect(txMock.user.create).toHaveBeenCalledTimes(1);
      expect(txMock.membership.create).toHaveBeenCalledTimes(1);
      expect(auditMock.record).toHaveBeenCalledWith(
        txMock,
        expect.objectContaining({ action: 'sso.login', tenantId: 't-1' }),
      );
    });

    it('generates SAML SP metadata and validates SAML response assertions', async () => {
      const storedSettings: Record<string, unknown> = {
        sso: {
          enabled: true,
          provider: 'SAML',
          autoProvision: true,
          entityId: 'https://idp.example.com/saml',
          ssoUrl: 'https://idp.example.com/saml/sso',
        },
      };

      const txMock = {
        tenant: { findUnique: vi.fn().mockResolvedValue({ settings: storedSettings }) },
        user: { findFirst: vi.fn().mockResolvedValue({ id: 'u-existing' }) },
        membership: { findUnique: vi.fn().mockResolvedValue({ id: 'm-1', status: 'ACTIVE' }) },
      };

      const dbMock = {
        prisma: { tenant: { findFirst: vi.fn().mockResolvedValue({ id: 't-1', slug: 'acme', settings: storedSettings }) } },
        tenantTx: vi.fn().mockImplementation((_ctx, fn) => fn(txMock)),
      };

      const auditMock = { record: vi.fn().mockResolvedValue({}) };
      const authMock = {
        issueSession: vi.fn().mockResolvedValue({
          accessToken: 'jwt-saml',
          context: { user: { id: 'u-existing', email: 'exec@acme.test' } },
        }),
      };

      const sso = new SsoService(dbMock as any, {} as any, auditMock as any, authMock as any, env as any);
      const xmlMeta = await sso.getSamlMetadata('t-1');
      expect(xmlMeta).toContain('<EntityDescriptor');
      expect(xmlMeta).toContain('AssertionConsumerService');

      const init = await sso.initiateLogin({ tenantSlug: 'acme' });
      expect(init.provider).toBe('SAML');

      const future = new Date(Date.now() + 300_000).toISOString();
      const samlXml = `<samlp:Response><saml:Assertion><saml:Conditions NotOnOrAfter="${future}"/><saml:Subject><saml:NameID>exec@acme.test</saml:NameID></saml:Subject></saml:Assertion></samlp:Response>`;
      const SAMLResponse = Buffer.from(samlXml, 'utf8').toString('base64');

      const session = await sso.handleSamlCallback(
        { SAMLResponse, RelayState: init.state },
        { ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-2' },
      );
      expect(session.accessToken).toBe('jwt-saml');
    });
  });

  describe('Immutable Audit Log Exports (WORM)', () => {
    it('exports SHA-256 hash-chained JSONL and detects tampering', async () => {
      const sampleLogs = [
        {
          id: 'log-1',
          tenantId: 't-1',
          actorUserId: 'u-1',
          action: 'lead.created',
          resourceType: 'lead',
          resourceId: 'l-1',
          metadata: { source: 'manual' },
          requestId: 'r-1',
          ip: '10.0.0.1',
          createdAt: new Date('2026-11-25T10:00:00.000Z'),
        },
        {
          id: 'log-2',
          tenantId: 't-1',
          actorUserId: 'u-1',
          action: 'lead.stage_changed',
          resourceType: 'lead',
          resourceId: 'l-1',
          metadata: { to: 'Qualified' },
          requestId: 'r-2',
          ip: '10.0.0.1',
          createdAt: new Date('2026-11-25T10:05:00.000Z'),
        },
      ];

      const txMock = {
        auditLog: {
          findMany: vi.fn().mockResolvedValue(sampleLogs),
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };

      const dbMock = {
        tenantTx: vi.fn().mockImplementation((_ctx, fn) => fn(txMock)),
      };

      const audit = new AuditService(dbMock as any, { JWT_ACCESS_SECRET: 'worm-secret' } as any);
      const { content, manifest } = await audit.exportWorm('t-1', { actorUserId: 'u-1' });

      expect(manifest.recordCount).toBe(2);
      expect(manifest.chainAlgorithm).toBe('SHA-256');
      expect(AuditService.verifyWormChain(content)).toEqual({
        valid: true,
        recordCount: 2,
        rootHash: manifest.rootHash,
      });

      // Tamper with first record action
      const tampered = content.replace('lead.created', 'lead.deleted');
      const check = AuditService.verifyWormChain(tampered);
      expect(check.valid).toBe(false);
      expect(check.error).toContain('Tampered record hash');
    });
  });

  describe('Partition Maintenance', () => {
    it('creates lookahead monthly partitions and drops expired partitions', async () => {
      const queryRaw = vi
        .fn()
        .mockResolvedValueOnce([{ res: 'audit_logs_y2026m11 already exists' }])
        .mockResolvedValueOnce([{ res: 'audit_logs_y2026m12' }])
        .mockResolvedValueOnce([{ res: 'audit_logs_y2027m01' }])
        .mockResolvedValueOnce([{ ok: true }]);

      const dbMock = { prisma: { $queryRaw: queryRaw } };
      const lifecycle = new LifecycleJobs(dbMock as any, {} as any, {} as any, {} as any, {} as any);

      const res = await lifecycle.maintainPartitions(new Date('2026-11-25T00:00:00.000Z'), {
        lookaheadMonths: 2,
        retainMonths: 12,
      });

      expect(res.created).toEqual(['audit_logs_y2026m12', 'audit_logs_y2027m01']);
      expect(res.dropped).toEqual(['audit_logs_y2025m10']);

      // Second call on same day is skipped unless forced
      const second = await lifecycle.maintainPartitions(new Date('2026-11-25T12:00:00.000Z'));
      expect(second).toEqual({ created: [], dropped: [] });
    });
  });
});
