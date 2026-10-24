import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomBytes, randomUUID } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { withTenant } from '../shared/tenancy/tenant-job';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import {
  InboundMailHandlerRegistry,
  InboundMailMessage,
  InboundMailPurpose,
} from '../contracts/inbound-mail/inbound-mail.contract';
import { recordAiProvenance } from '../contracts/ai/provenance.contract';
import { InboundMailbox } from './entities/inbound-mailbox.entity';
import { InboundMessage, InboundMessageStatus, StoredInboundAttachment } from './entities/inbound-message.entity';
import { ParsedInboundMail, senderAllowed, tokenOf } from './inbound-payload';

export const INBOUND_MAIL_QUEUE = 'inbound-mail';

/** The local part of each purpose's address: `bills+…@`, `orders+…@`. */
const LOCAL_PART: Record<InboundMailPurpose, string> = { BILLS: 'bills', ORDERS: 'orders' };

export type ReceiveResult =
  | { accepted: true; messageId: string; duplicate: boolean }
  | { accepted: false; reason: 'unknown_mailbox' | 'sender_not_allowed' | 'not_authenticated' | 'no_content' };

/**
 * A company's mail addresses, and the mail that arrives at them.
 *
 * Receiving is quick and does no reading: the message is authenticated (the webhook signature,
 * then the receiver's SPF/DKIM verdict when it gives one), matched to its company by the token in
 * the address, checked against the mailbox's senders, stored once (by Message-ID) and queued. The
 * module registered for its purpose turns it into drafts in the background.
 */
@Injectable()
export class InboundMailService {
  private readonly logger = new Logger(InboundMailService.name);

  constructor(
    @InjectRepository(InboundMailbox) private readonly mailboxes: Repository<InboundMailbox>,
    @InjectRepository(InboundMessage) private readonly messages: Repository<InboundMessage>,
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly handlers: InboundMailHandlerRegistry,
    private readonly config: ConfigService,
    @InjectQueue(INBOUND_MAIL_QUEUE) private readonly queue: Queue,
  ) {}

  /** Whether mail can be received at all: a domain to receive at and a secret to verify with. */
  configured(): boolean {
    return !!this.domain() && !!this.config.get<string>('INBOUND_MAIL_WEBHOOK_SECRET');
  }

  domain(): string | null {
    return this.config.get<string>('INBOUND_MAIL_DOMAIN')?.trim().toLowerCase() || null;
  }

  // ── Mailboxes ───────────────────────────────────────────────────────────────

  address(mailbox: Pick<InboundMailbox, 'purpose' | 'token'>): string | null {
    const domain = this.domain();
    return domain ? `${LOCAL_PART[mailbox.purpose]}+${mailbox.token}@${domain}` : null;
  }

  async listMailboxes(organizationId: string) {
    const rows = await this.mailboxes.find({ where: { organizationId } });
    return rows.map((row) => this.publicMailbox(row));
  }

  /** Create the company's address for a purpose, or give it a new token (the old address stops working). */
  async rotate(organizationId: string, purpose: InboundMailPurpose, userId: string) {
    const existing = await this.mailboxes.findOne({ where: { organizationId, purpose } });
    const token = randomBytes(16).toString('hex');
    const saved = await this.mailboxes.save(
      existing ? Object.assign(existing, { token, active: true }) : this.mailboxes.create({ organizationId, purpose, token, active: true, allowedSenders: [], createdByUserId: userId }),
    );
    return this.publicMailbox(saved);
  }

  async updateMailbox(organizationId: string, purpose: InboundMailPurpose, change: { active?: boolean; allowedSenders?: string[] }) {
    const mailbox = await this.mailboxes.findOne({ where: { organizationId, purpose } });
    if (!mailbox) throw new NotFoundError('inbound_mail.mailbox_not_found');
    if (change.active !== undefined) mailbox.active = change.active;
    if (change.allowedSenders !== undefined) {
      const cleaned = [...new Set(change.allowedSenders.map((value) => value.trim().toLowerCase()).filter(Boolean))];
      if (cleaned.some((value) => !/^(@[a-z0-9.-]+\.[a-z]{2,}|[^@\s]+@[a-z0-9.-]+\.[a-z]{2,})$/.test(value))) {
        throw new BadRequestError('inbound_mail.invalid_sender');
      }
      mailbox.allowedSenders = cleaned.slice(0, 100);
    }
    return this.publicMailbox(await this.mailboxes.save(mailbox));
  }

  private publicMailbox(row: InboundMailbox) {
    return { purpose: row.purpose, address: this.address(row), active: row.active, allowedSenders: row.allowedSenders, updatedAt: row.updatedAt };
  }

  // ── Receiving ───────────────────────────────────────────────────────────────

  async receive(mail: ParsedInboundMail): Promise<ReceiveResult> {
    // A sender whose own domain says the message is forged is not who it claims to be.
    if (mail.authenticated === false) return { accepted: false, reason: 'not_authenticated' };
    const domain = this.domain();
    let found: { mailbox_id: string; organization_id: string; purpose: InboundMailPurpose; allowed_senders: string[] } | undefined;
    for (const recipient of mail.recipients) {
      const token = tokenOf(recipient, domain);
      if (!token) continue;
      [found] = await this.dataSource.query(`SELECT * FROM inbound_mailbox_by_token($1)`, [token]);
      if (found) break;
    }
    if (!found) return { accepted: false, reason: 'unknown_mailbox' };
    if (!senderAllowed(mail.from, found.allowed_senders ?? [])) return { accepted: false, reason: 'sender_not_allowed' };
    if (!mail.attachments.length && !mail.text.trim()) return { accepted: false, reason: 'no_content' };
    const mailbox = found;

    return withTenant(this.dataSource, mailbox.organization_id, async () => {
      const existing = await this.messages.findOne({ where: { organizationId: mailbox.organization_id, messageId: mail.messageId } });
      if (existing) return { accepted: true as const, messageId: existing.id, duplicate: true };
      const attachments: StoredInboundAttachment[] = [];
      for (const file of mail.attachments) {
        const stored = await this.storage.upload({ fileName: file.fileName, mimeType: file.mimeType, buffer: file.buffer }, `inbound-mail/${mailbox.organization_id}`);
        attachments.push({ id: randomUUID(), fileName: file.fileName, mimeType: file.mimeType, size: file.buffer.length, storageKey: stored.storageKey });
      }
      const saved = await this.messages.save(
        this.messages.create({
          organizationId: mailbox.organization_id,
          mailboxId: mailbox.mailbox_id,
          purpose: mailbox.purpose,
          messageId: mail.messageId,
          fromAddress: mail.from,
          fromName: mail.fromName,
          subject: mail.subject,
          bodyText: mail.text,
          attachments,
          status: 'RECEIVED',
          receivedAt: new Date(),
        }),
      );
      await this.enqueue(saved);
      return { accepted: true as const, messageId: saved.id, duplicate: false };
    });
  }

  private async enqueue(message: Pick<InboundMessage, 'id' | 'organizationId'>): Promise<void> {
    await this.queue.add(
      'process',
      { organizationId: message.organizationId, messageId: message.id },
      { jobId: `inbound-${message.id}-${Date.now()}`, attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 500, removeOnFail: 500 },
    );
  }

  // ── Processing ──────────────────────────────────────────────────────────────

  /**
   * Hand a message to its purpose's module. Each step that touches the database opens its own
   * tenant connection: the module may spend a minute with a model and must not hold one meanwhile.
   */
  async process(organizationId: string, messageId: string, finalAttempt: boolean): Promise<void> {
    const message = await withTenant(this.dataSource, organizationId, async () => {
      const row = await this.messages.findOne({ where: { id: messageId, organizationId }, relations: ['mailbox'] });
      if (!row || !['RECEIVED', 'FAILED', 'PROCESSING'].includes(row.status)) return null;
      row.status = 'PROCESSING';
      row.attempts += 1;
      return this.messages.save(row);
    });
    if (!message) return;
    const handler = this.handlers.get(message.purpose);
    if (!handler) {
      await this.finish(organizationId, messageId, 'FAILED', 'inbound_mail.no_handler', [], null);
      return;
    }
    try {
      const outcome = await handler.handle(this.toMessage(message));
      await this.finish(organizationId, messageId, outcome.status, outcome.reason ?? null, outcome.records, outcome.review ?? null);
      if (outcome.records.length) {
        await withTenant(this.dataSource, organizationId, async () => {
          for (const record of outcome.records) {
            await recordAiProvenance(this.dataSource.manager, {
              organizationId,
              entityType: record.type,
              entityId: record.id,
              source: 'AI_MAIL',
              detail: { inboundMessageId: messageId, from: message.fromAddress, subject: message.subject },
            });
          }
        });
      }
    } catch (error) {
      this.logger.warn(`Inbound message ${messageId} failed: ${(error as Error)?.message ?? error}`);
      // Kept for a retry; on the last attempt it shows as failed in the inbox, with its retry button.
      await this.finish(organizationId, messageId, finalAttempt ? 'FAILED' : 'RECEIVED', 'inbound_mail.processing_failed', [], null);
      if (!finalAttempt) throw error;
    }
  }

  private toMessage(row: InboundMessage): InboundMailMessage {
    return {
      id: row.id,
      organizationId: row.organizationId,
      purpose: row.purpose,
      from: row.fromAddress,
      fromName: row.fromName,
      subject: row.subject,
      text: row.bodyText,
      receivedAt: row.receivedAt,
      mailboxOwnerUserId: row.mailbox?.createdByUserId ?? null,
      attachments: row.attachments.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        read: () => this.readStored(attachment.storageKey),
      })),
    };
  }

  private async readStored(storageKey: string): Promise<Buffer> {
    const { stream } = await this.storage.getStream(storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  private finish(
    organizationId: string,
    messageId: string,
    status: InboundMessageStatus,
    reason: string | null,
    records: InboundMessage['records'],
    review: Record<string, unknown> | null,
  ) {
    return withTenant(this.dataSource, organizationId, () =>
      this.messages.update({ id: messageId, organizationId }, { status, reason, records, review: review as never, processedAt: new Date() }),
    );
  }

  // ── The inbox ───────────────────────────────────────────────────────────────

  async list(organizationId: string, purpose: InboundMailPurpose, statuses?: InboundMessageStatus[], limit = 50) {
    const rows = await this.messages.find({
      where: { organizationId, purpose, ...(statuses?.length ? { status: In(statuses) } : {}) },
      order: { receivedAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((row) => ({
      id: row.id,
      from: row.fromAddress,
      fromName: row.fromName,
      subject: row.subject,
      receivedAt: row.receivedAt,
      status: row.status,
      reason: row.reason,
      records: row.records,
      review: row.review,
      attachments: row.attachments.map(({ id, fileName, mimeType, size }) => ({ id, fileName, mimeType, size })),
    }));
  }

  async retry(organizationId: string, purpose: InboundMailPurpose, id: string) {
    const row = await this.messages.findOne({ where: { id, organizationId, purpose } });
    if (!row) throw new NotFoundError('inbound_mail.message_not_found');
    if (!['FAILED', 'NEEDS_REVIEW', 'REJECTED'].includes(row.status)) throw new BadRequestError('inbound_mail.not_retryable');
    row.status = 'RECEIVED';
    row.reason = null;
    await this.messages.save(row);
    await this.enqueue(row);
    return { id: row.id, status: row.status };
  }

  /** A person handled it (or it was not for us): it leaves the inbox. */
  async dismiss(organizationId: string, purpose: InboundMailPurpose, id: string, userId: string) {
    const row = await this.messages.findOne({ where: { id, organizationId, purpose } });
    if (!row) throw new NotFoundError('inbound_mail.message_not_found');
    row.status = 'DISMISSED';
    row.resolvedByUserId = userId;
    await this.messages.save(row);
    return { id: row.id, status: row.status };
  }

  /** One attachment of a message, to open from the inbox. */
  async attachment(organizationId: string, purpose: InboundMailPurpose, id: string, attachmentId: string) {
    const row = await this.messages.findOne({ where: { id, organizationId, purpose } });
    const attachment = row?.attachments.find((item) => item.id === attachmentId);
    if (!attachment) throw new NotFoundError('inbound_mail.message_not_found');
    const file = await this.storage.getStream(attachment.storageKey);
    return { attachment, file };
  }
}
