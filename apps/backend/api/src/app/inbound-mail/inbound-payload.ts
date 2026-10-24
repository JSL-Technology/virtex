import { createHmac, timingSafeEqual } from 'crypto';

/**
 * The webhook's wire format, and how it is authenticated.
 *
 * Whatever receives the mail (an SES rule with a small function, Postmark, SendGrid's inbound
 * parse, a self-hosted Postfix pipe) posts one JSON document per message:
 *
 *   { "to": ["bills+TOKEN@in.example.com"], "from": "Ana <ana@supplier.com>", "subject": "…",
 *     "messageId": "<…@mail>", "text": "…", "html": "…",
 *     "authentication": { "spf": "pass", "dkim": "pass" },
 *     "attachments": [{ "fileName": "…", "contentType": "application/pdf", "contentBase64": "…" }] }
 *
 * signed in the `x-virtex-signature` header as `t=<unix seconds>,v1=<hex HMAC-SHA256 of
 * "<t>.<raw body>">` with INBOUND_MAIL_WEBHOOK_SECRET. The timestamp makes a captured request
 * useless five minutes later; the HMAC over the exact bytes makes it impossible to alter.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 300;
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;
export const MAX_TEXT_CHARS = 20_000;
const ACCEPTED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/xml', 'text/xml']);

export function signPayload(secret: string, timestamp: number, rawBody: Buffer | string): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

/** Whether the header proves the body came from our receiver, now. */
export function verifySignature(secret: string, header: string | undefined, rawBody: Buffer, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((part) => part.trim().split('=', 2) as [string, string]));
  const timestamp = Number(parts['t']);
  const given = parts['v1'];
  if (!Number.isFinite(timestamp) || !given || !/^[0-9a-f]{64}$/i.test(given)) return false;
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(signPayload(secret, timestamp, rawBody), 'hex');
  const actual = Buffer.from(given, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface ParsedAttachment {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

export interface ParsedInboundMail {
  recipients: string[];
  from: string;
  fromName: string | null;
  subject: string;
  messageId: string;
  text: string;
  attachments: ParsedAttachment[];
  /** Attachments left out (too many, too large, a type no handler reads). */
  skipped: Array<{ fileName: string; reason: 'type' | 'size' | 'count' }>;
  /** The receiver's own SPF/DKIM verdicts, when it gives them. A failing one means a forged sender. */
  authenticated: boolean | null;
}

/** The address and display name of a `From` header: `Ana Pérez <ana@x.com>` or `ana@x.com`. */
export function parseAddress(raw: string): { address: string; name: string | null } {
  const text = (raw ?? '').trim();
  const angle = text.match(/^(.*)<([^>]+)>\s*$/);
  const address = (angle ? angle[2] : text).trim().toLowerCase();
  const name = angle ? angle[1].trim().replace(/^"|"$/g, '').trim() || null : null;
  return { address, name };
}

/** The token in `bills+TOKEN@domain`, if the address is on our domain. */
export function tokenOf(recipient: string, domain: string | null): string | null {
  const { address } = parseAddress(recipient);
  const match = address.match(/^[a-z]+\+([a-z0-9_-]{16,64})@(.+)$/i);
  if (!match) return null;
  if (domain && match[2].toLowerCase() !== domain.toLowerCase()) return null;
  return match[1];
}

/** HTML reduced to readable text, for a body that came only as HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

/** Validates and normalises the posted document. Throws on a document that is not a message. */
export function parseInboundMail(body: unknown): ParsedInboundMail {
  if (!body || typeof body !== 'object') throw new Error('not an object');
  const raw = body as Record<string, unknown>;
  const recipients = (Array.isArray(raw['to']) ? raw['to'] : [raw['to']]).filter((value): value is string => typeof value === 'string' && value.length < 400);
  const from = typeof raw['from'] === 'string' ? parseAddress(raw['from']) : null;
  if (!recipients.length || !from?.address.includes('@')) throw new Error('missing to/from');
  const messageId = typeof raw['messageId'] === 'string' && raw['messageId'].trim() ? raw['messageId'].trim().slice(0, 255) : null;
  if (!messageId) throw new Error('missing messageId');
  const text = typeof raw['text'] === 'string' && raw['text'].trim() ? raw['text'] : typeof raw['html'] === 'string' ? htmlToText(raw['html']) : '';
  const auth = raw['authentication'] as Record<string, unknown> | undefined;
  const verdicts = auth ? [auth['spf'], auth['dkim']].filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase()) : [];
  const attachments: ParsedAttachment[] = [];
  const skipped: ParsedInboundMail['skipped'] = [];
  for (const item of Array.isArray(raw['attachments']) ? raw['attachments'] : []) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const fileName = String(entry['fileName'] ?? 'attachment').replace(/[\\/\r\n]/g, '_').slice(0, 200);
    const mimeType = String(entry['contentType'] ?? '').toLowerCase().split(';')[0].trim();
    if (!ACCEPTED_TYPES.has(mimeType)) {
      skipped.push({ fileName, reason: 'type' });
      continue;
    }
    if (attachments.length >= MAX_ATTACHMENTS) {
      skipped.push({ fileName, reason: 'count' });
      continue;
    }
    const buffer = Buffer.from(String(entry['contentBase64'] ?? ''), 'base64');
    if (!buffer.length || buffer.length > MAX_ATTACHMENT_BYTES) {
      skipped.push({ fileName, reason: 'size' });
      continue;
    }
    attachments.push({ fileName, mimeType, buffer });
  }
  return {
    recipients,
    from: from.address.slice(0, 320),
    fromName: from.name?.slice(0, 200) ?? null,
    subject: typeof raw['subject'] === 'string' ? raw['subject'].replace(/[\r\n]+/g, ' ').slice(0, 500) : '',
    messageId,
    text: text.slice(0, MAX_TEXT_CHARS),
    attachments,
    skipped,
    authenticated: verdicts.length ? verdicts.every((verdict) => verdict === 'pass') : null,
  };
}

/** Whether a sender may write to a mailbox: any, or one listed (an address, or `@domain`). */
export function senderAllowed(sender: string, allowed: string[]): boolean {
  if (!allowed.length) return true;
  const address = sender.toLowerCase();
  return allowed.some((rule) => {
    const value = rule.trim().toLowerCase();
    return value.startsWith('@') ? address.endsWith(value) : address === value;
  });
}
