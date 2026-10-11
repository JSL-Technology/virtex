import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { isDevLikeEnvironment } from '../config/environment';

/**
 * A local mailbox for development, used when no SMTP server is configured.
 *
 * Signup cannot be completed without the code it e-mails, and a development machine usually has no
 * SMTP server. Every message then failed to connect to `localhost:587`, was retried five times and
 * landed in the failed queue, and the code was nowhere a developer could read it. With this, the
 * message is rendered exactly as it would be sent and written to disk; the log names the file.
 *
 * Only in development and test, and only when `MAIL_HOST` is unset: a configured server is always
 * used, and a deployment cannot reach this branch because `MAIL_HOST` is required there.
 */
export function devOutboxEnabled(config: ConfigService): boolean {
  return isDevLikeEnvironment() && !config.get<string>('MAIL_HOST');
}

/** Where the development mailbox writes. `MAIL_OUTBOX_DIR` overrides the default. */
export function devOutboxDir(config: ConfigService): string {
  return config.get<string>('MAIL_OUTBOX_DIR') || join(process.cwd(), 'tmp', 'mail-outbox');
}

/** What nodemailer's `jsonTransport` hands back: the whole message, serialized. */
interface JsonTransportInfo {
  message?: string;
}

interface SerializedMessage {
  subject?: string;
  html?: string;
  text?: string;
  to?: Array<{ address: string }>;
}

/**
 * Writes a message produced by `jsonTransport` to the outbox and returns the HTML file's path, or
 * null when the transport did not produce one.
 */
export function saveToDevOutbox(info: unknown, dir: string, now = new Date()): string | null {
  const raw = (info as JsonTransportInfo | undefined)?.message;
  if (typeof raw !== 'string') return null;

  const message = JSON.parse(raw) as SerializedMessage;
  mkdirSync(dir, { recursive: true });
  const slug = (message.subject ?? 'message')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .toLowerCase();
  const base = join(dir, `${now.toISOString().replace(/[:.]/g, '-')}-${slug || 'message'}`);
  writeFileSync(`${base}.html`, message.html ?? `<pre>${message.text ?? ''}</pre>`);
  writeFileSync(`${base}.json`, JSON.stringify(message, null, 2));
  return `${base}.html`;
}
