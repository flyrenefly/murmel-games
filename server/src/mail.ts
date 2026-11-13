import nodemailer from 'nodemailer';
import type { Mailer } from './konten.ts';

/**
 * SMTP mailer from SMTP_HOST, SMTP_USER, SMTP_PASSWORD, MAIL_FROM (and optional SMTP_PORT, default 587
 * with STARTTLS; 465 = TLS from the start). Values live only in /opt/murmel/.env. Missing values: null,
 * and the login says that mail is not set up.
 */
export function mailerFromEnv(env: NodeJS.ProcessEnv): Mailer | null {
  const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASSWORD: pass, MAIL_FROM: from } = env;
  if (!host || !user || !pass || !from) return null;
  const port = Number(env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    async send(to, subject, text) {
      await transport.sendMail({ from, to, subject, text });
    },
  };
}
