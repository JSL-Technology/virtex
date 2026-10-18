import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { numericTransformer } from '../../common/database/numeric.transformer';
import type { Customer } from '../../customers/entities/customer.entity';
import type { Invoice } from '../../invoices/entities/invoice.entity';

export const COLLECTION_ACTIVITY_KINDS = ['REMINDER', 'CALL', 'PROMISE', 'NOTE'] as const;
export type CollectionActivityKind = (typeof COLLECTION_ACTIVITY_KINDS)[number];

export const COLLECTION_ACTIVITY_STATUSES = ['DRAFT', 'DONE', 'CANCELLED'] as const;
export type CollectionActivityStatus = (typeof COLLECTION_ACTIVITY_STATUSES)[number];

export const COLLECTION_CHANNELS = ['email', 'phone', 'whatsapp', 'visit', 'other'] as const;
export type CollectionChannel = (typeof COLLECTION_CHANNELS)[number];

/** What a call achieved. A promise is recorded as its own activity, with its date. */
export const CALL_OUTCOMES = ['reached', 'no_answer', 'promised', 'disputed', 'wrong_contact', 'paid_already'] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/**
 * One thing done to get an invoice (or a customer's balance) paid. A DRAFT is a reminder written
 * and not yet sent; nothing else is ever a draft.
 */
@Entity({ name: 'collection_activities' })
@Index('IDX_collection_activities_org_invoice', ['organizationId', 'invoiceId'])
@Index('IDX_collection_activities_org_customer_occurred', ['organizationId', 'customerId', 'occurredAt'])
@Check('CHK_collection_activities_kind', `"kind" IN ('REMINDER', 'CALL', 'PROMISE', 'NOTE')`)
@Check('CHK_collection_activities_status', `"status" IN ('DRAFT', 'DONE', 'CANCELLED')`)
@Check('CHK_collection_activities_draft_reminder', `"status" <> 'DRAFT' OR "kind" = 'REMINDER'`)
@Check('CHK_collection_activities_promise', `"kind" <> 'PROMISE' OR "promised_date" IS NOT NULL`)
@Check('CHK_collection_activities_promised_amount', `"promised_amount" IS NULL OR "promised_amount" > 0`)
export class CollectionActivity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_collection_activities_organization')
  organization?: TenantRef;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @ManyToOne('Customer', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id', foreignKeyConstraintName: 'FK_collection_activities_customer' })
  customer?: Customer;

  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoiceId: string | null;

  @ManyToOne('Invoice', { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'invoice_id', foreignKeyConstraintName: 'FK_collection_activities_invoice' })
  invoice?: Invoice | null;

  @Column({ type: 'varchar', length: 16 })
  kind: CollectionActivityKind;

  @Column({ type: 'varchar', length: 16, default: 'DONE' })
  status: CollectionActivityStatus;

  @Column({ name: 'occurred_at', type: 'timestamptz', default: () => 'now()' })
  occurredAt: Date;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  channel: CollectionChannel | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  outcome: CallOutcome | null;

  @Column({ name: 'promised_date', type: 'date', nullable: true })
  promisedDate: string | null;

  @Column({ name: 'promised_amount', type: 'numeric', precision: 18, scale: 2, nullable: true, transformer: numericTransformer })
  promisedAmount: number | null;

  @Column({ type: 'varchar', length: 320, nullable: true })
  recipient: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  subject: string | null;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  tone: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
