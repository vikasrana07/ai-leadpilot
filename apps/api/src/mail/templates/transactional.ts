import { escapeHtml, renderEmailLayout, textToHtmlParagraphs } from './layout.js';

export type TransactionalTemplateKey =
  | 'auth_verify_email'
  | 'auth_account_exists'
  | 'auth_password_reset'
  | 'team_invitation'
  | 'security_mfa_reset'
  | 'portal_otp'
  | 'billing_notice';

export interface TransactionalTemplateVars {
  auth_verify_email: { verifyUrl: string };
  auth_account_exists: { loginUrl: string };
  auth_password_reset: { resetUrl: string };
  team_invitation: { inviterName: string; workspaceName: string; acceptUrl: string };
  security_mfa_reset: { loginUrl: string };
  portal_otp: { code: string; businessName: string };
  billing_notice: { subject: string; message: string; billingUrl: string; ctaLabel?: string };
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html?: string;
}

type Renderer<K extends TransactionalTemplateKey> = (vars: TransactionalTemplateVars[K]) => RenderedEmail;

const REGISTRY: { [K in TransactionalTemplateKey]: Renderer<K> } = {
  auth_verify_email: ({ verifyUrl }) => ({
    subject: 'Verify your LeadPilot email',
    text: `Welcome to LeadPilot.\n\nConfirm your email: ${verifyUrl}\n\nThis link expires in 24 hours.`,
    html: renderEmailLayout({
      preheader: 'Confirm your email address to activate your LeadPilot account.',
      heading: 'Verify your email address',
      bodyHtml: textToHtmlParagraphs(
        'Welcome to LeadPilot.\n\nPlease confirm your email address to complete your registration. This verification link expires in 24 hours.',
      ),
      cta: { label: 'Verify Email', url: verifyUrl },
      fallbackUrl: verifyUrl,
      footerNote: 'If you did not create a LeadPilot account, you can safely ignore this email.',
    }),
  }),

  auth_account_exists: ({ loginUrl }) => ({
    subject: 'You already have a LeadPilot account',
    text: `Someone tried to register with this email. You already have an account: ${loginUrl}\n\nIf that was not you, you can ignore this message.`,
    html: renderEmailLayout({
      preheader: 'Someone tried to register with this email address.',
      heading: 'You already have an account',
      bodyHtml: textToHtmlParagraphs(
        'Someone tried to register a new LeadPilot account using this email address, which is already registered.\n\nYou can sign in directly using the button below.',
      ),
      cta: { label: 'Sign In to LeadPilot', url: loginUrl },
      fallbackUrl: loginUrl,
      footerNote: 'If that was not you, no action is needed and you can safely ignore this email.',
    }),
  }),

  auth_password_reset: ({ resetUrl }) => ({
    subject: 'Reset your LeadPilot password',
    text: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you did not request it, ignore this email.`,
    html: renderEmailLayout({
      preheader: 'Reset your LeadPilot password (expires in 1 hour).',
      heading: 'Reset your password',
      bodyHtml: textToHtmlParagraphs(
        'We received a request to reset the password for your LeadPilot account.\n\nClick the button below to choose a new password. This link expires in 1 hour.',
      ),
      cta: { label: 'Reset Password', url: resetUrl },
      fallbackUrl: resetUrl,
      footerNote: 'If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.',
    }),
  }),

  team_invitation: ({ inviterName, workspaceName, acceptUrl }) => ({
    subject: `${inviterName} invited you to ${workspaceName} on LeadPilot`,
    text: `Join ${workspaceName}: ${acceptUrl}\n\nThis invitation expires in 7 days.`,
    html: renderEmailLayout({
      preheader: `${inviterName} invited you to collaborate in ${workspaceName}.`,
      heading: `You're invited to ${workspaceName}`,
      bodyHtml: textToHtmlParagraphs(
        `${inviterName} has invited you to join the ${workspaceName} workspace on LeadPilot.\n\nAccept the invitation below to get started. This invitation expires in 7 days.`,
      ),
      cta: { label: `Join ${workspaceName}`, url: acceptUrl },
      fallbackUrl: acceptUrl,
      footerNote: 'If you were not expecting this invitation, you can ignore this email.',
    }),
  }),

  security_mfa_reset: ({ loginUrl }) => ({
    subject: 'Your two-step verification was reset',
    text: `A workspace administrator reset two-step verification on your LeadPilot account, and you were signed out. Sign in with your password and set it up again: ${loginUrl}\n\nIf you did not expect this, change your password and contact your workspace owner.`,
    html: renderEmailLayout({
      preheader: 'Security notice: your two-step verification was reset by an administrator.',
      heading: 'Two-step verification was reset',
      bodyHtml: textToHtmlParagraphs(
        'A workspace administrator reset two-step verification (MFA) on your LeadPilot account, and active sessions were signed out.\n\nSign in with your password and set up two-step verification again as soon as possible.',
      ),
      cta: { label: 'Sign In & Re-enroll MFA', url: loginUrl },
      fallbackUrl: loginUrl,
      footerNote: 'If you did not expect this change, reset your password immediately and contact your workspace owner.',
    }),
  }),

  // Security constraint: intentionally contains NO links so it cannot be turned into a phishing vector.
  portal_otp: ({ code, businessName }) => ({
    subject: `Your sign-in code for ${businessName}`,
    text: `Your code is ${code}\n\nIt expires in 10 minutes and works once. If you did not ask for it, ignore this message: nobody can sign in without it.`,
    html: renderEmailLayout({
      brandName: businessName,
      preheader: `Your one-time sign-in code is ${code}`,
      heading: 'Your sign-in code',
      bodyHtml: `
        <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#334155;">
          Use the one-time code below to sign in to <strong>${escapeHtml(businessName)}</strong>:
        </p>
        <div style="margin:20px 0;padding:16px 24px;background-color:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:28px;font-weight:700;letter-spacing:6px;color:#0f172a;">
          ${escapeHtml(code)}
        </div>
        <p style="margin:0;font-size:14px;line-height:1.6;color:#475569;">
          This code expires in 10 minutes and can only be used once. If you did not request it, you can ignore this message.
        </p>`,
      footerNote: `Sent on behalf of ${businessName}. Never share this code with anyone.`,
    }),
  }),

  billing_notice: ({ subject, message, billingUrl, ctaLabel }) => ({
    subject,
    text: `${message}\n\nManage billing: ${billingUrl}`,
    html: renderEmailLayout({
      preheader: message.slice(0, 140),
      heading: subject,
      bodyHtml: textToHtmlParagraphs(message),
      cta: { label: ctaLabel ?? 'Manage Billing', url: billingUrl },
      fallbackUrl: billingUrl,
    }),
  }),
};

export function renderTransactionalEmail<K extends TransactionalTemplateKey>(
  key: K,
  vars: TransactionalTemplateVars[K],
): RenderedEmail {
  return REGISTRY[key](vars);
}
