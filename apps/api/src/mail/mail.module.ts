import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { renderTransactionalEmail } from './templates/index.js';

@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  private readonly transport: Transporter;
  constructor(@Inject(ENV) private readonly env: Env) {
    this.transport = createTransport({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465,
      // Local Mailpit speaks plain SMTP; production must negotiate TLS (STARTTLS on 587, implicit TLS on 465).
      ...(env.NODE_ENV === 'production' ? { requireTLS: env.SMTP_PORT !== 465 } : { ignoreTLS: true }),
      ...(env.SMTP_USER && env.SMTP_PASS ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
    });
  }

  /** Mail failures never break the calling flow; they are logged (no recipient content, no tokens). */
  private async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    try {
      await this.transport.sendMail({ from: this.env.MAIL_FROM, to, subject, text, ...(html ? { html } : {}) });
    } catch (err) {
      // The subject can carry a person's or a business name, so it is not logged; only the failure reason (the logger redacts addresses).
      this.log.error(`Failed to send an email: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Generic mail sender supporting HTML and custom email headers (e.g. SES tracking tags, configuration sets, message-ids).
   */
  async sendCustom(opts: { to: string; subject: string; text: string; html?: string; headers?: Record<string, string> }): Promise<{ messageId: string | null }> {
    try {
      const res = await this.transport.sendMail({
        from: this.env.MAIL_FROM,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
        headers: opts.headers,
      });
      return { messageId: res?.messageId ?? null };
    } catch (err) {
      this.log.error(`Failed to send custom email: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  sendVerification(to: string, token: string): Promise<void> {
    const verifyUrl = `${this.env.WEB_ORIGIN}/verify-email?token=${encodeURIComponent(token)}`;
    const rendered = renderTransactionalEmail('auth_verify_email', { verifyUrl });
    return this.send(to, rendered.subject, rendered.text, rendered.html);
  }
  sendPasswordReset(to: string, token: string): Promise<void> {
    const resetUrl = `${this.env.WEB_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;
    const rendered = renderTransactionalEmail('auth_password_reset', { resetUrl });
    return this.send(to, rendered.subject, rendered.text, rendered.html);
  }
  sendInvitation(to: string, token: string, workspaceName: string, inviterName: string): Promise<void> {
    const acceptUrl = `${this.env.WEB_ORIGIN}/accept-invite?token=${encodeURIComponent(token)}`;
    const rendered = renderTransactionalEmail('team_invitation', { inviterName, workspaceName, acceptUrl });
    return this.send(to, rendered.subject, rendered.text, rendered.html);
  }
  /** Plain billing/dunning notice. Callers pass the subject and body; no card or invoice-number data beyond what the caller chooses to include. */
  sendBilling(to: string, subject: string, text: string): Promise<void> {
    const rendered = renderTransactionalEmail('billing_notice', {
      subject,
      message: text,
      billingUrl: `${this.env.WEB_ORIGIN}/billing`,
    });
    return this.send(to, rendered.subject, rendered.text, rendered.html);
  }
  /** Platform monitoring alert (plain text built by ops/alert-rules.ts: rule text and numbers only). */
  sendAlert(to: string, subject: string, text: string): Promise<void> { return this.send(to, subject, text); }
  /** The one-time sign-in code of the customer portal. Short, no links (so it cannot be turned into a phishing link), and it says who asked. */
  sendPortalCode(to: string, code: string, businessName: string): Promise<void> {
    const rendered = renderTransactionalEmail('portal_otp', { code, businessName });
    return this.send(to, rendered.subject, rendered.text, rendered.html);
  }
  sendMfaReset(to: string): Promise<void> {
    const rendered = renderTransactionalEmail('security_mfa_reset', { loginUrl: `${this.env.WEB_ORIGIN}/login` });
    return this.send(to, rendered.subject, rendered.text, rendered.html);
  }
  sendAccountExists(to: string): Promise<void> {
    const rendered = renderTransactionalEmail('auth_account_exists', { loginUrl: `${this.env.WEB_ORIGIN}/login` });
    return this.send(to, rendered.subject, rendered.text, rendered.html);
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
