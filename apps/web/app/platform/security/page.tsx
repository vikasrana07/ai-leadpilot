'use client';

import { CheckCircle2, Lock, Shield, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/page/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { MfaPanel } from '@/components/security/mfa-panel';
import { platformApi } from '@/lib/platform';

const call = <T,>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) =>
  platformApi<T>(`/security/mfa${path}`, {
    method,
    ...(body !== undefined ? { body } : {}),
  });

export default function PlatformSecurity() {
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Admin Security & Verification"
        description="Two-step authentication and session security posture for platform operators."
      />

      {/* Security Context Banner */}
      <div className="flex items-start gap-3.5 rounded-xl border border-primary/20 bg-primary-soft/40 p-4 text-[13px] text-foreground">
        <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-foreground">
            Administrative Access Standards
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground leading-relaxed">
            Platform administrators have elevated capabilities to suspend workspaces, alter billing quotas, and initiate customer support sessions. MFA is mandatory to safeguard against unauthorized account takeovers.
          </p>
        </div>
      </div>

      {/* Security Guarantees Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2.5 text-foreground font-semibold text-[13px]">
            <Lock className="h-4 w-4 text-primary" />
            <span>Isolated Sessions</span>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
            Platform auth cookies are strictly segregated from workspace customer sessions.
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2.5 text-foreground font-semibold text-[13px]">
            <Shield className="h-4 w-4 text-emerald-500" />
            <span>Audit Immutability</span>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
            Every login, verification challenge, and configuration change is logged append-only.
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2.5 text-foreground font-semibold text-[13px]">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <span>Time-based OTP</span>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
            Compatible with 1Password, Google Authenticator, Authy, and hardware tokens.
          </p>
        </Card>
      </div>

      {/* MFA Configuration Panel */}
      <Card className="overflow-hidden">
        <CardBody className="p-6">
          <h2 className="text-[16px] font-semibold text-foreground mb-1">
            Two-Step Verification (TOTP)
          </h2>
          <p className="text-[13px] text-muted-foreground mb-6">
            Configure an authenticator app to generate time-sensitive 6-digit verification codes.
          </p>
          <MfaPanel call={call} queryKey={['platform-mfa']} />
        </CardBody>
      </Card>
    </div>
  );
}
