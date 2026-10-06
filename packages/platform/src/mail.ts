import { createTransport } from 'nodemailer';

export interface MailMessage { to: string; subject: string; text: string; html?: string }
export interface MailerLike { readonly enabled: boolean; send(m: MailMessage): Promise<{ id?: string }> }

/** SMTP transport (works with SES, Postmark, SendGrid, Mailgun, Gmail, any relay). `SMTP_URL=smtps://user:pass@host:465`, `MAIL_FROM="LeadDesk <no-reply@example.com>"`. */
export function createSmtpMailer(env: NodeJS.ProcessEnv = process.env): MailerLike | null {
  if (!env.SMTP_URL || !env.MAIL_FROM) return null;
  const transport = createTransport(env.SMTP_URL, { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
  const from = env.MAIL_FROM;
  return {
    enabled: true,
    async send(m) {
      const r = await transport.sendMail({ from, to: m.to, subject: m.subject.replace(/[\r\n]+/g, ' ').slice(0, 200), text: m.text, html: m.html });
      return { id: r.messageId };
    },
  };
}
