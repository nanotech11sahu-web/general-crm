import { appendFileSync } from 'node:fs';
import { Global, Module } from '@nestjs/common';
import { NullMailer, type Mailer } from '@leaddesk/domain';
import { createSmtpMailer } from '@leaddesk/platform';

export const MAILER = Symbol('MAILER');

/** SMTP when SMTP_URL + MAIL_FROM are set, otherwise a null mailer: flows that need email degrade to "copy the link" instead of failing. */
/** Browser tests run the real API as a separate process, so mail is appended to a file they can read. Refused outside NODE_ENV=test. */
function captureMailer(): Mailer | null {
  const file = process.env.MAIL_CAPTURE_FILE;
  if (!file || process.env.NODE_ENV !== 'test') return null;
  return { enabled: true, async send(m) { appendFileSync(file, `${JSON.stringify(m)}\n`); return {}; } };
}

@Global()
@Module({ providers: [{ provide: MAILER, useFactory: (): Mailer => { const m = captureMailer() ?? createSmtpMailer(); if (!m && process.env.NODE_ENV === 'production') console.warn('SMTP_URL/MAIL_FROM not set: password reset and email notices are disabled'); return m ?? new NullMailer(); } }], exports: [MAILER] })
export class MailModule {}
