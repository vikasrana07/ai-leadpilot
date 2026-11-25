'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api, API_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/forms';

type SsoProviderType = 'OIDC' | 'SAML';

interface SsoPublicConfig {
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

export function SsoConfigCard() {
  const { can, activeWorkspace } = useAuth();
  const qc = useQueryClient();
  const canManage = can('settings:manage');

  const config = useQuery({
    queryKey: ['sso', 'config'],
    enabled: canManage,
    queryFn: () => api<SsoPublicConfig>('/auth/sso/config'),
  });

  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<SsoProviderType>('OIDC');
  const [autoProvision, setAutoProvision] = useState(true);
  const [defaultRole, setDefaultRole] = useState('agent');
  // OIDC
  const [issuerUrl, setIssuerUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  // SAML
  const [entityId, setEntityId] = useState('');
  const [ssoUrl, setSsoUrl] = useState('');
  const [certificatePem, setCertificatePem] = useState('');

  useEffect(() => {
    if (!config.data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: syncs form fields when server config loads
    setEnabled(config.data.enabled);
    setProvider(config.data.provider ?? 'OIDC');
    setAutoProvision(config.data.autoProvision);
    setDefaultRole(config.data.defaultRole || 'agent');
    setIssuerUrl(config.data.issuerUrl ?? '');
    setClientId(config.data.clientId ?? '');
    setEntityId(config.data.entityId ?? '');
    setSsoUrl(config.data.ssoUrl ?? '');
  }, [config.data]);

  const save = useMutation({
    mutationFn: () =>
      api<SsoPublicConfig>('/auth/sso/config', {
        method: 'PUT',
        body: {
          enabled,
          provider,
          autoProvision,
          defaultRole: defaultRole.trim() || 'agent',
          ...(provider === 'OIDC'
            ? {
                ...(issuerUrl.trim() ? { issuerUrl: issuerUrl.trim() } : {}),
                ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
                ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
              }
            : {
                ...(entityId.trim() ? { entityId: entityId.trim() } : {}),
                ...(ssoUrl.trim() ? { ssoUrl: ssoUrl.trim() } : {}),
                ...(certificatePem.trim() ? { certificatePem: certificatePem.trim() } : {}),
              }),
        },
      }),
    onSuccess: async () => {
      toast.success('Single Sign-On settings saved');
      setClientSecret('');
      setCertificatePem('');
      await qc.invalidateQueries({ queryKey: ['sso', 'config'] });
    },
    onError: (e) => handleApiError(e),
  });

  const remove = useMutation({
    mutationFn: () => api('/auth/sso/config', { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Single Sign-On disabled and cleared');
      setEnabled(false);
      setIssuerUrl('');
      setClientId('');
      setClientSecret('');
      setEntityId('');
      setSsoUrl('');
      setCertificatePem('');
      await qc.invalidateQueries({ queryKey: ['sso', 'config'] });
    },
    onError: (e) => handleApiError(e),
  });

  if (!canManage) return null;

  const tenantId = activeWorkspace?.tenantId;
  const metadataUrl = tenantId ? `${API_URL}/auth/sso/metadata/${tenantId}` : '';

  function copy(value: string, label: string) {
    void navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
          <CardTitle>Enterprise Single Sign-On (OIDC / SAML 2.0)</CardTitle>
        </div>
        {config.data?.enabled ? (
          <Badge tone="success">
            <ShieldCheck className="h-3 w-3" aria-hidden />
            {config.data.provider} Active
          </Badge>
        ) : (
          <Badge>Off</Badge>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-helper">
          Allow team members to sign in with your corporate Identity Provider (Okta, Google Workspace, Microsoft Entra ID) with optional Just-In-Time provisioning.
        </p>

        {config.isPending ? (
          <div className="space-y-3"><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
            className="space-y-4"
          >
            <div className="flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-2 text-[13px] font-medium">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                Enable SSO for this workspace
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={autoProvision} onChange={(e) => setAutoProvision(e.target.checked)} />
                Auto-provision new users (JIT)
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="sso-provider" className="text-label mb-1 block">Protocol</label>
                <Select id="sso-provider" value={provider} onChange={(e) => setProvider(e.target.value as SsoProviderType)}>
                  <option value="OIDC">OpenID Connect (OIDC)</option>
                  <option value="SAML">SAML 2.0</option>
                </Select>
              </div>
              <div>
                <label htmlFor="sso-role" className="text-label mb-1 block">Default JIT Role</label>
                <Select id="sso-role" value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)}>
                  <option value="agent">Agent</option>
                  <option value="manager">Manager</option>
                </Select>
              </div>
            </div>

            {provider === 'OIDC' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="oidc-issuer" className="text-label mb-1 block">Issuer URL</label>
                  <Input
                    id="oidc-issuer"
                    placeholder="https://accounts.google.com or https://your-org.okta.com"
                    value={issuerUrl}
                    onChange={(e) => setIssuerUrl(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="oidc-client-id" className="text-label mb-1 block">Client ID</label>
                  <Input
                    id="oidc-client-id"
                    placeholder="0oa1b2c3d4..."
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="oidc-client-secret" className="text-label mb-1 block">
                    Client Secret {config.data?.hasClientSecret ? <span className="text-success font-normal">(configured)</span> : null}
                  </label>
                  <Input
                    id="oidc-client-secret"
                    type="password"
                    placeholder={config.data?.hasClientSecret ? 'Leave blank to keep existing secret' : 'Enter client secret'}
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {metadataUrl ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px]">
                    <div className="min-w-0">
                      <span className="font-medium">SP Metadata XML URL: </span>
                      <code className="truncate text-muted-foreground">{metadataUrl}</code>
                    </div>
                    <Button type="button" size="sm" variant="ghost" onClick={() => copy(metadataUrl, 'SP Metadata URL')}>
                      <Copy className="h-3.5 w-3.5" aria-hidden />
                      Copy
                    </Button>
                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="saml-entity" className="text-label mb-1 block">IdP Entity ID</label>
                    <Input
                      id="saml-entity"
                      placeholder="https://idp.example.com/saml/metadata"
                      value={entityId}
                      onChange={(e) => setEntityId(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="saml-sso-url" className="text-label mb-1 block">IdP SSO URL</label>
                    <Input
                      id="saml-sso-url"
                      placeholder="https://idp.example.com/saml/sso"
                      value={ssoUrl}
                      onChange={(e) => setSsoUrl(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="saml-cert" className="text-label mb-1 block">
                    X.509 Signing Certificate (PEM) {config.data?.hasCertificate ? <span className="text-success font-normal">(configured)</span> : null}
                  </label>
                  <textarea
                    id="saml-cert"
                    rows={3}
                    placeholder={config.data?.hasCertificate ? 'Leave blank to keep existing certificate' : '-----BEGIN CERTIFICATE-----\n...'}
                    value={certificatePem}
                    onChange={(e) => setCertificatePem(e.target.value)}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-[12px] outline-none focus:border-primary"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              {config.data?.provider ? (
                <Button type="button" size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>
                  <Trash2 className="h-3.5 w-3.5 text-danger" aria-hidden />
                  Clear SSO config
                </Button>
              ) : <span />}
              <Button type="submit" variant="primary" loading={save.isPending}>Save SSO settings</Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
