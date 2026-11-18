import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';

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
  private async send(to: string, subject: string, text: string): Promise<void> {
    try {
      await this.transport.sendMail({ from: this.env.MAIL_FROM, to, subject, text });
    } catch (err) {
      // The subject can carry a person's or a business name, so it is not logged; only the failure reason (the logger redacts addresses).
      this.log.error(`Failed to send an email: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  sendVerification(to: string, token: string): Promise<void> {
    const link = `${this.env.WEB_ORIGIN}/verify-email?token=${encodeURIComponent(token)}`;
    return this.send(to, 'Verify your LeadPilot email', `Welcome to LeadPilot.\n\nConfirm your email: ${link}\n\nThis link expires in 24 hours.`);
  }
  sendPasswordReset(to: string, token: string): Promise<void> {
    const link = `${this.env.WEB_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;
    return this.send(to, 'Reset your LeadPilot password', `Reset your password: ${link}\n\nThis link expires in 1 hour. If you did not request it, ignore this email.`);
  }
  sendInvitation(to: string, token: string, workspace: string, inviter: string): Promise<void> {
    const link = `${this.env.WEB_ORIGIN}/accept-invite?token=${encodeURIComponent(token)}`;
    return this.send(to, `${inviter} invited you to ${workspace} on LeadPilot`, `Join ${workspace}: ${link}\n\nThis invitation expires in 7 days.`);
  }
  /** Plain billing/dunning notice. Callers pass the subject and body; no card or invoice-number data beyond what the caller chooses to include. */
  sendBilling(to: string, subject: string, text: string): Promise<void> { return this.send(to, subject, `${text}\n\nManage billing: ${this.env.WEB_ORIGIN}/billing`); }
  /** Platform monitoring alert (plain text built by ops/alert-rules.ts: rule text and numbers only). */
  sendAlert(to: string, subject: string, text: string): Promise<void> { return this.send(to, subject, text); }
  sendMfaReset(to: string): Promise<void> {
    return this.send(to, 'Your two-step verification was reset', `A workspace administrator reset two-step verification on your LeadPilot account, and you were signed out. Sign in with your password and set it up again: ${this.env.WEB_ORIGIN}/login\n\nIf you did not expect this, change your password and contact your workspace owner.`);
  }
  sendAccountExists(to: string): Promise<void> {
    return this.send(to, 'You already have a LeadPilot account', `Someone tried to register with this email. You already have an account: ${this.env.WEB_ORIGIN}/login\n\nIf that was not you, you can ignore this message.`);
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
