import { describe, expect, it } from 'vitest';
import {
  FOLLOWUP_TEMPLATES,
  escapeHtml,
  renderFollowupTemplate,
  renderTransactionalEmail,
} from '../src/mail/templates/index.js';

describe('Email Templates', () => {
  describe('Transactional Templates', () => {
    it('renders auth_verify_email with CTA link and text fallback', () => {
      const res = renderTransactionalEmail('auth_verify_email', {
        verifyUrl: 'https://app.leadpilot.io/verify-email?token=abc',
      });
      expect(res.subject).toBe('Verify your LeadPilot email');
      expect(res.text).toContain('https://app.leadpilot.io/verify-email?token=abc');
      expect(res.html).toContain('Verify Email');
      expect(res.html).toContain('https://app.leadpilot.io/verify-email?token=abc');
    });

    it('renders auth_password_reset with 1-hour expiry note', () => {
      const res = renderTransactionalEmail('auth_password_reset', {
        resetUrl: 'https://app.leadpilot.io/reset-password?token=xyz',
      });
      expect(res.subject).toBe('Reset your LeadPilot password');
      expect(res.text).toContain('1 hour');
      expect(res.html).toContain('Reset Password');
    });

    it('renders team_invitation and escapes HTML in inviter/workspace names', () => {
      const res = renderTransactionalEmail('team_invitation', {
        inviterName: 'Alice <script>alert(1)</script>',
        workspaceName: 'Acme & Co',
        acceptUrl: 'https://app.leadpilot.io/accept-invite?token=t1',
      });
      expect(res.subject).toContain('Acme & Co');
      expect(res.html).not.toContain('<script>');
      expect(res.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(res.html).toContain('Acme &amp; Co');
    });

    it('renders portal_otp with NO hyperlinks (anti-phishing constraint)', () => {
      const res = renderTransactionalEmail('portal_otp', {
        code: '482910',
        businessName: 'Sunrise Realty',
      });
      expect(res.subject).toBe('Your sign-in code for Sunrise Realty');
      expect(res.text).toContain('482910');
      expect(res.text).not.toMatch(/https?:\/\//i);
      expect(res.html).toContain('482910');
      expect(res.html).not.toMatch(/<a\s/i);
      expect(res.html).not.toMatch(/https?:\/\//i);
    });

    it('renders billing_notice, security_mfa_reset, and auth_account_exists', () => {
      const billing = renderTransactionalEmail('billing_notice', {
        subject: 'Your LeadPilot trial ends soon',
        message: 'Choose a plan before Friday.',
        billingUrl: 'https://app.leadpilot.io/billing',
      });
      expect(billing.html).toContain('Manage Billing');
      expect(billing.text).toContain('https://app.leadpilot.io/billing');

      const mfa = renderTransactionalEmail('security_mfa_reset', {
        loginUrl: 'https://app.leadpilot.io/login',
      });
      expect(mfa.html).toContain('Two-step verification was reset');

      const exists = renderTransactionalEmail('auth_account_exists', {
        loginUrl: 'https://app.leadpilot.io/login',
      });
      expect(exists.html).toContain('You already have an account');
    });
  });

  describe('Follow-up Templates', () => {
    it('renders every follow-up template with substituted variables and escaped HTML', () => {
      expect(FOLLOWUP_TEMPLATES.length).toBeGreaterThanOrEqual(6);

      for (const tpl of FOLLOWUP_TEMPLATES) {
        const rendered = renderFollowupTemplate(tpl.key, {
          lead: { name: 'Rohan Sharma' },
          business: { name: 'Apex Homes & Co' },
          agent: { name: 'Priya' },
          appointment: { date: '28 Nov', time: '11:00 AM', location: 'Zoom' },
        });
        expect(rendered).not.toBeNull();
        expect(rendered!.subject).not.toContain('{{');
        expect(rendered!.text).not.toContain('{{');
        expect(rendered!.html).toContain('Apex Homes &amp; Co');
      }
    });

    it('falls back gracefully when optional context fields are missing', () => {
      const rendered = renderFollowupTemplate('followup_welcome', {});
      expect(rendered).not.toBeNull();
      expect(rendered!.text).toContain('Hi there');
      expect(rendered!.text).toContain('our team');
    });

    it('escapes HTML special characters via escapeHtml', () => {
      expect(escapeHtml(`<b onclick="x">'test' & "ok"</b>`)).toBe(
        '&lt;b onclick=&quot;x&quot;&gt;&#39;test&#39; &amp; &quot;ok&quot;&lt;/b&gt;',
      );
    });
  });
});
