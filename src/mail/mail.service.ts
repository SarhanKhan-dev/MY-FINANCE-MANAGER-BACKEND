import { Injectable, Logger } from '@nestjs/common';

/**
 * Sends email through Resend's REST API (https://resend.com).
 * Does nothing until RESEND_API_KEY is set — every send is best-effort and
 * never fails the business operation that triggered it.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  get isConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY);
  }

  private get from(): string {
    return process.env.EMAIL_FROM || 'PAIS-e <onboarding@resend.dev>';
  }

  async send(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.isConfigured) return false;
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: this.from, to: [to], subject, html }),
      });
      if (!response.ok) {
        this.logger.warn(`Resend refused (${response.status}): ${await response.text()}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(`Email send failed: ${(error as Error).message}`);
      return false;
    }
  }

  private layout(body: string): string {
    return `<div style="font-family:'Nunito Sans',Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#171717">
      <p style="font-size:20px;font-weight:800;margin:0 0 16px">PAIS-&euml;</p>
      ${body}
      <p style="font-size:12px;color:#a3a3a3;margin-top:24px">PAIS-&euml; by DataBlox &middot; if this wasn't you, ignore this email.</p>
    </div>`;
  }

  async sendPasswordLink(to: string, link: string, purpose: 'invite' | 'reset'): Promise<boolean> {
    const heading =
      purpose === 'invite' ? 'Welcome — set your password' : 'Reset your password';
    const note =
      purpose === 'invite'
        ? 'Your account is ready. Click below to choose a password.'
        : 'Click below to choose a new password. The link works once and expires in 5 minutes.';
    return this.send(
      to,
      `PAIS-ë: ${heading}`,
      this.layout(
        `<p style="font-size:15px">${note}</p>
         <p style="margin:20px 0"><a href="${link}" style="background:#171717;color:#fff;padding:10px 20px;border-radius:10px;text-decoration:none;font-size:14px">${heading}</a></p>
         <p style="font-size:12px;color:#737373">Or paste this link: ${link}</p>`,
      ),
    );
  }

  async sendPin(to: string, pin: string): Promise<boolean> {
    return this.send(
      to,
      'PAIS-ë: your lock PIN',
      this.layout(
        `<p style="font-size:15px">Your 4-digit lock PIN:</p>
         <p style="font-size:32px;font-weight:800;letter-spacing:0.3em;margin:16px 0">${pin}</p>
         <p style="font-size:13px;color:#737373">It unlocks the app when you step away. You can change it in Settings.</p>`,
      ),
    );
  }
}
