import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import type { InboundMailPurpose, InboundMailOutcome } from '../../contracts/inbound-mail/inbound-mail.contract';
import { InboundMailbox } from './inbound-mailbox.entity';

export type InboundMessageStatus = 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'NEEDS_REVIEW' | 'REJECTED' | 'FAILED' | 'DISMISSED';

export interface StoredInboundAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  storageKey: string;
}

/** A message received at a company's address, and what became of it. */
@Entity({ name: 'inbound_messages' })
@Unique('UQ_inbound_messages_org_message', ['organizationId', 'messageId'])
@Index('IDX_inbound_messages_org_purpose_received', ['organizationId', 'purpose', 'receivedAt'])
@Check(
  'CHK_inbound_messages_status',
  `"status" IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'NEEDS_REVIEW', 'REJECTED', 'FAILED', 'DISMISSED')`,
)
export class InboundMessage {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_inbound_messages' })
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_inbound_messages_organization')
  organization?: TenantRef;

  @Column({ name: 'mailbox_id', type: 'uuid' })
  mailboxId: string;

  @ManyToOne(() => InboundMailbox, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'mailbox_id', foreignKeyConstraintName: 'FK_inbound_messages_mailbox' })
  mailbox?: InboundMailbox;

  @Column({ type: 'varchar', length: 16 })
  purpose: InboundMailPurpose;

  /** The sender's Message-ID: the same message delivered twice is received once. */
  @Column({ name: 'message_id', type: 'varchar', length: 255 })
  messageId: string;

  @Column({ name: 'from_address', type: 'varchar', length: 320 })
  fromAddress: string;

  @Column({ name: 'from_name', type: 'varchar', length: 200, nullable: true })
  fromName: string | null;

  @Column({ type: 'varchar', length: 500, default: '' })
  subject: string;

  @Column({ name: 'body_text', type: 'text', default: '' })
  bodyText: string;

  @Column({ type: 'jsonb', default: [] })
  attachments: StoredInboundAttachment[];

  @Column({ type: 'varchar', length: 16, default: 'RECEIVED' })
  status: InboundMessageStatus;

  /** Why it was not processed, as an i18n key. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  reason: string | null;

  @Column({ type: 'jsonb', default: [] })
  records: InboundMailOutcome['records'];

  @Column({ type: 'jsonb', nullable: true })
  review: Record<string, unknown> | null;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'received_at', type: 'timestamptz', default: () => 'now()' })
  receivedAt: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @Column({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId: string | null;
}
