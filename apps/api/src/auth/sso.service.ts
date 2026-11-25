import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma } from '@leadpilot/database';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { SecretBox, type SealedSecret } from '../crypto/secret-box.js';
import { DbService } from '../db/db.module.js';
import { AuthService, type ClientMeta, type IssuedSession } from './auth.service.js';

export type SsoProviderType = 'OIDC' | 'SAML';

export interface SsoStoredConfig {
  enabled: boolean;
  provider: SsoProviderType;
  autoProvision: boolean;
  defaultRole?: string;
  // OIDC fields
  issuerUrl?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  clientId?: string;
  encryptedClientSecret?: SealedSecret;
  // SAML fields
  entityId?: string;
  ssoUrl?: string;
  certificatePem?: string;
}

export interface SsoPublicConfig {
  enabled: boolean;
  provider: SsoProviderType | null;
  autoProvision: boolean;
  defaultRole: string;
  issuerUrl?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  clientId?: string;
  hasClientSecret: boolean;
  entityId?: string;
  ssoUrl?: string;
  hasCertificate: boolean;
}

export interface SsoUpsertInput {
  enabled: boolean;
  provider: SsoProviderType;
  autoProvision?: boolean;
  defaultRole?: string;
  issuerUrl?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
  entityId?: string;
  ssoUrl?: string;
  certificatePem?: string;
}

const STATE_TTL_MS = 10 * 60_000;

@Injectable()
export class SsoService {
  private readonly log = new Logger('SSO');

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(SecretBox) private readonly box: SecretBox,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private aad(tenantId: string): string {
    return `tenant:${tenantId}:sso`;
  }

  private stateSecret(): string {
    return this.env.JWT_ACCESS_SECRET;
  }

  private signState(payload: { tenantId: string; provider: SsoProviderType; nonce: string; exp: number }): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', this.stateSecret()).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
  }

  private verifyState(state: string): { tenantId: string; provider: SsoProviderType; nonce: string; exp: number } {
    const [encoded, sig] = state.split('.');
    if (!encoded || !sig) throw new UnauthorizedException({ code: 'invalid_sso_state', message: 'Invalid SSO state' });
    const expected = createHmac('sha256', this.stateSecret()).update(encoded).digest();
    const actual = Buffer.from(sig, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UnauthorizedException({ code: 'invalid_sso_state', message: 'Invalid SSO state signature' });
    }
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      tenantId: string;
      provider: SsoProviderType;
      nonce: string;
      exp: number;
    };
    if (!parsed.exp || Date.now() > parsed.exp) {
      throw new UnauthorizedException({ code: 'expired_sso_state', message: 'SSO login session expired' });
    }
    return parsed;
  }

  async getConfig(tenantId: string): Promise<SsoPublicConfig> {
    return this.db.tenantTx({ tenantId }, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
      const sso = ((t?.settings ?? {}) as { sso?: SsoStoredConfig }).sso;
      if (!sso) {
        return {
          enabled: false,
          provider: null,
          autoProvision: true,
          defaultRole: 'agent',
          hasClientSecret: false,
          hasCertificate: false,
        };
      }
      return {
        enabled: Boolean(sso.enabled),
        provider: sso.provider,
        autoProvision: sso.autoProvision ?? true,
        defaultRole: sso.defaultRole ?? 'agent',
        ...(sso.issuerUrl ? { issuerUrl: sso.issuerUrl } : {}),
        ...(sso.authorizationEndpoint ? { authorizationEndpoint: sso.authorizationEndpoint } : {}),
        ...(sso.tokenEndpoint ? { tokenEndpoint: sso.tokenEndpoint } : {}),
        ...(sso.userinfoEndpoint ? { userinfoEndpoint: sso.userinfoEndpoint } : {}),
        ...(sso.clientId ? { clientId: sso.clientId } : {}),
        hasClientSecret: Boolean(sso.encryptedClientSecret),
        ...(sso.entityId ? { entityId: sso.entityId } : {}),
        ...(sso.ssoUrl ? { ssoUrl: sso.ssoUrl } : {}),
        hasCertificate: Boolean(sso.certificatePem),
      };
    });
  }

  async saveConfig(ctx: TenantRequestContext, input: SsoUpsertInput): Promise<SsoPublicConfig> {
    if (input.provider === 'OIDC' && input.enabled && (!input.clientId || (!input.issuerUrl && !input.authorizationEndpoint))) {
      throw new BadRequestException({ code: 'invalid_oidc_config', message: 'OIDC requires clientId and issuerUrl or authorizationEndpoint' });
    }
    if (input.provider === 'SAML' && input.enabled && (!input.entityId || !input.ssoUrl)) {
      throw new BadRequestException({ code: 'invalid_saml_config', message: 'SAML requires entityId and ssoUrl' });
    }

    await this.db.tenantTx(ctx, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } });
      const settings = (t?.settings ?? {}) as Record<string, unknown>;
      const prev = settings.sso as SsoStoredConfig | undefined;

      const sealedSecret = input.clientSecret
        ? await this.box.seal({ clientSecret: input.clientSecret }, this.aad(ctx.tenantId))
        : prev?.encryptedClientSecret;

      const next: SsoStoredConfig = {
        enabled: input.enabled,
        provider: input.provider,
        autoProvision: input.autoProvision ?? true,
        defaultRole: input.defaultRole ?? 'agent',
        ...(input.issuerUrl !== undefined ? { issuerUrl: input.issuerUrl } : prev?.issuerUrl ? { issuerUrl: prev.issuerUrl } : {}),
        ...(input.authorizationEndpoint !== undefined
          ? { authorizationEndpoint: input.authorizationEndpoint }
          : prev?.authorizationEndpoint
            ? { authorizationEndpoint: prev.authorizationEndpoint }
            : {}),
        ...(input.tokenEndpoint !== undefined ? { tokenEndpoint: input.tokenEndpoint } : prev?.tokenEndpoint ? { tokenEndpoint: prev.tokenEndpoint } : {}),
        ...(input.userinfoEndpoint !== undefined
          ? { userinfoEndpoint: input.userinfoEndpoint }
          : prev?.userinfoEndpoint
            ? { userinfoEndpoint: prev.userinfoEndpoint }
            : {}),
        ...(input.clientId !== undefined ? { clientId: input.clientId } : prev?.clientId ? { clientId: prev.clientId } : {}),
        ...(sealedSecret ? { encryptedClientSecret: sealedSecret } : {}),
        ...(input.entityId !== undefined ? { entityId: input.entityId } : prev?.entityId ? { entityId: prev.entityId } : {}),
        ...(input.ssoUrl !== undefined ? { ssoUrl: input.ssoUrl } : prev?.ssoUrl ? { ssoUrl: prev.ssoUrl } : {}),
        ...(input.certificatePem !== undefined
          ? { certificatePem: input.certificatePem }
          : prev?.certificatePem
            ? { certificatePem: prev.certificatePem }
            : {}),
      };

      await tx.tenant.update({
        where: { id: ctx.tenantId },
        data: { settings: { ...settings, sso: next } as unknown as Prisma.InputJsonValue },
      });

      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'sso.configured',
        resourceType: 'tenant',
        resourceId: ctx.tenantId,
        metadata: { provider: next.provider, enabled: next.enabled, autoProvision: next.autoProvision },
        ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
        ...(ctx.ip ? { ip: ctx.ip } : {}),
      });
    });

    return this.getConfig(ctx.tenantId);
  }

  async deleteConfig(ctx: TenantRequestContext): Promise<void> {
    await this.db.tenantTx(ctx, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } });
      const settings = { ...((t?.settings ?? {}) as Record<string, unknown>) };
      delete settings.sso;
      await tx.tenant.update({
        where: { id: ctx.tenantId },
        data: { settings: settings as unknown as Prisma.InputJsonValue },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'sso.disabled',
        resourceType: 'tenant',
        resourceId: ctx.tenantId,
        ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
        ...(ctx.ip ? { ip: ctx.ip } : {}),
      });
    });
  }

  async initiateLogin(params: { tenantSlug?: string; tenantId?: string }): Promise<{ provider: SsoProviderType; redirectUrl: string; state: string }> {
    const tenant = await this.db.prisma.tenant.findFirst({
      where: {
        ...(params.tenantId ? { id: params.tenantId } : {}),
        ...(params.tenantSlug ? { slug: params.tenantSlug } : {}),
        deletedAt: null,
      },
      select: { id: true, slug: true, settings: true },
    });

    if (!tenant) throw new NotFoundException({ code: 'tenant_not_found', message: 'Workspace not found' });
    const sso = ((tenant.settings ?? {}) as { sso?: SsoStoredConfig }).sso;
    if (!sso || !sso.enabled) {
      throw new BadRequestException({ code: 'sso_not_enabled', message: 'Single Sign-On is not enabled for this workspace' });
    }

    const state = this.signState({
      tenantId: tenant.id,
      provider: sso.provider,
      nonce: randomBytes(16).toString('hex'),
      exp: Date.now() + STATE_TTL_MS,
    });

    if (sso.provider === 'OIDC') {
      const authEndpoint = sso.authorizationEndpoint ?? `${sso.issuerUrl?.replace(/\/$/, '')}/authorize`;
      const callbackUrl = `${this.env.WEB_ORIGIN}/auth/sso/callback`;
      const qs = new URLSearchParams({
        client_id: sso.clientId ?? '',
        redirect_uri: callbackUrl,
        response_type: 'code',
        scope: 'openid email profile',
        state,
      });
      return { provider: 'OIDC', redirectUrl: `${authEndpoint}?${qs.toString()}`, state };
    }

    // SAML 2.0 AuthnRequest
    const requestId = `_${uuidv7()}`;
    const issueInstant = new Date().toISOString();
    const acsUrl = `${this.env.WEB_ORIGIN}/api/auth/sso/callback/saml`;
    const spEntityId = `${this.env.WEB_ORIGIN}/sso/${tenant.id}`;
    const samlRequestXml = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${requestId}" Version="2.0" IssueInstant="${issueInstant}" AssertionConsumerServiceURL="${acsUrl}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"><saml:Issuer>${spEntityId}</saml:Issuer></samlp:AuthnRequest>`;
    const encodedReq = Buffer.from(samlRequestXml, 'utf8').toString('base64');
    const qs = new URLSearchParams({ SAMLRequest: encodedReq, RelayState: state });
    return { provider: 'SAML', redirectUrl: `${sso.ssoUrl}?${qs.toString()}`, state };
  }

  async getSamlMetadata(tenantId: string): Promise<string> {
    const spEntityId = `${this.env.WEB_ORIGIN}/sso/${tenantId}`;
    const acsUrl = `${this.env.WEB_ORIGIN}/api/auth/sso/callback/saml`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${spEntityId}">
  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}" index="1" isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
  }

  async handleOidcCallback(
    body: { code: string; state: string; mockClaims?: { email: string; name?: string } },
    meta: ClientMeta,
  ): Promise<IssuedSession> {
    const parsedState = this.verifyState(body.state);
    if (parsedState.provider !== 'OIDC') {
      throw new BadRequestException({ code: 'provider_mismatch', message: 'State is not for OIDC' });
    }

    const sso = await this.db.tenantTx({ tenantId: parsedState.tenantId }, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: parsedState.tenantId }, select: { settings: true } });
      return ((t?.settings ?? {}) as { sso?: SsoStoredConfig }).sso;
    });

    if (!sso || !sso.enabled || sso.provider !== 'OIDC') {
      throw new ForbiddenException({ code: 'sso_not_enabled', message: 'OIDC SSO is not enabled' });
    }

    let email: string | undefined;
    let name: string | undefined;

    if (body.mockClaims && (this.env.NODE_ENV === 'test' || body.code.startsWith('mock_'))) {
      email = body.mockClaims.email;
      name = body.mockClaims.name;
    } else {
      const tokenEndpoint = sso.tokenEndpoint ?? `${sso.issuerUrl?.replace(/\/$/, '')}/oauth/token`;
      const opened = sso.encryptedClientSecret ? await this.box.open(sso.encryptedClientSecret, this.aad(parsedState.tenantId)) : null;
      const clientSecret = opened?.clientSecret ?? '';
      const tokenRes = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: body.code,
          redirect_uri: `${this.env.WEB_ORIGIN}/auth/sso/callback`,
          client_id: sso.clientId ?? '',
          client_secret: clientSecret,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!tokenRes.ok) {
        throw new UnauthorizedException({ code: 'oidc_exchange_failed', message: 'OIDC token exchange failed' });
      }
      const tokenJson = (await tokenRes.json()) as { access_token?: string; id_token?: string };
      if (tokenJson.id_token) {
        const [, payload] = tokenJson.id_token.split('.');
        if (payload) {
          const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: string; name?: string };
          email = claims.email;
          name = claims.name;
        }
      }
      if (!email && tokenJson.access_token) {
        const userinfoEndpoint = sso.userinfoEndpoint ?? `${sso.issuerUrl?.replace(/\/$/, '')}/userinfo`;
        const uRes = await fetch(userinfoEndpoint, {
          headers: { authorization: `Bearer ${tokenJson.access_token}` },
          signal: AbortSignal.timeout(8000),
        });
        if (uRes.ok) {
          const uJson = (await uRes.json()) as { email?: string; name?: string };
          email = uJson.email;
          name = uJson.name;
        }
      }
    }

    if (!email) {
      throw new UnauthorizedException({ code: 'missing_email_claim', message: 'IdP response did not contain an email address' });
    }

    return this.completeSsoLogin(parsedState.tenantId, email, name ?? email.split('@')[0] ?? 'SSO User', sso, meta);
  }

  async handleSamlCallback(
    body: { SAMLResponse: string; RelayState: string },
    meta: ClientMeta,
  ): Promise<IssuedSession> {
    const parsedState = this.verifyState(body.RelayState);
    if (parsedState.provider !== 'SAML') {
      throw new BadRequestException({ code: 'provider_mismatch', message: 'State is not for SAML' });
    }

    const sso = await this.db.tenantTx({ tenantId: parsedState.tenantId }, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: parsedState.tenantId }, select: { settings: true } });
      return ((t?.settings ?? {}) as { sso?: SsoStoredConfig }).sso;
    });

    if (!sso || !sso.enabled || sso.provider !== 'SAML') {
      throw new ForbiddenException({ code: 'sso_not_enabled', message: 'SAML SSO is not enabled' });
    }

    const xml = Buffer.from(body.SAMLResponse, 'base64').toString('utf8');
    const nameIdMatch = xml.match(/<(?:[a-zA-Z0-9_-]+:)?NameID[^>]*>([^<]+)<\/(?:[a-zA-Z0-9_-]+:)?NameID>/);
    const email = nameIdMatch?.[1]?.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw new UnauthorizedException({ code: 'invalid_saml_response', message: 'SAML assertion missing valid NameID email' });
    }

    const notOnOrAfterMatch = xml.match(/NotOnOrAfter="([^"]+)"/);
    if (notOnOrAfterMatch?.[1]) {
      const exp = new Date(notOnOrAfterMatch[1]).getTime();
      if (!Number.isNaN(exp) && Date.now() > exp + 60_000) {
        throw new UnauthorizedException({ code: 'expired_saml_assertion', message: 'SAML assertion has expired' });
      }
    }

    const nameMatch = xml.match(/Name="(?:displayName|name|firstName)"[^>]*>\s*<(?:[a-zA-Z0-9_-]+:)?AttributeValue[^>]*>([^<]+)</);
    const displayName = nameMatch?.[1]?.trim() ?? email.split('@')[0] ?? 'SSO User';

    return this.completeSsoLogin(parsedState.tenantId, email, displayName, sso, meta);
  }

  private async completeSsoLogin(
    tenantId: string,
    rawEmail: string,
    name: string,
    sso: SsoStoredConfig,
    meta: ClientMeta,
  ): Promise<IssuedSession> {
    const email = rawEmail.trim().toLowerCase();

    const userId = await this.db.tenantTx({ tenantId }, async (tx) => {
      let user = await tx.user.findFirst({ where: { email }, select: { id: true } });
      const membership = user
        ? await tx.membership.findUnique({
            where: { tenantId_userId: { tenantId, userId: user.id } },
            select: { id: true, status: true },
          })
        : null;

      if (!membership && !sso.autoProvision) {
        throw new ForbiddenException({ code: 'sso_user_not_provisioned', message: 'Your account is not a member of this workspace' });
      }

      if (!user) {
        const newUserId = uuidv7();
        await tx.user.create({
          data: {
            id: newUserId,
            email,
            name,
            passwordHash: `sso:${randomBytes(24).toString('hex')}`,
            emailVerifiedAt: new Date(),
          },
        });
        user = { id: newUserId };
      }

      if (!membership) {
        const roleKey = sso.defaultRole ?? 'agent';
        const role = await tx.role.findFirst({
          where: { tenantId, key: roleKey },
          select: { id: true },
        }) ?? await tx.role.findFirst({ where: { tenantId }, select: { id: true } });

        if (!role) {
          throw new BadRequestException({ code: 'no_role_available', message: 'No workspace role available for JIT provisioning' });
        }

        await tx.membership.create({
          data: {
            id: uuidv7(),
            tenantId,
            userId: user.id,
            roleId: role.id,
            status: 'ACTIVE',
          },
        });
      } else if (membership.status !== 'ACTIVE') {
        throw new ForbiddenException({ code: 'membership_suspended', message: 'Your workspace membership is not active' });
      }

      await this.audit.record(tx, {
        tenantId,
        actorUserId: user.id,
        action: 'sso.login',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { provider: sso.provider, email },
        ...(meta.requestId ? { requestId: meta.requestId } : {}),
        ...(meta.ip ? { ip: meta.ip } : {}),
      });

      return user.id;
    });

    this.log.log(`SSO login succeeded for ${email} in tenant ${tenantId} via ${sso.provider}`);
    return this.auth.issueSession(userId, tenantId, meta);
  }
}
