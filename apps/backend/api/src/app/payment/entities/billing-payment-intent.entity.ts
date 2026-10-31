import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { encryptedColumnTransformer } from '../../common/database/encrypted-column.transformer';

export enum BillingIntentStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  DECLINED = 'DECLINED',
  CANCELLED = 'CANCELLED',
  VOIDED = 'VOIDED',
}

export type BillingIntentKind = 'registration' | 'organization' | 'renewal';

/** One subscription charge through a local acquirer. See the migration for why it exists. */
@Entity('billing_payment_intents')
@Unique('UQ_billing_payment_intents_order', ['provider', 'orderNumber'])
@Index('IDX_billing_payment_intents_org', ['organizationId', 'createdAt'])
@Index('IDX_billing_payment_intents_uninvoiced', ['status'], { where: '"invoiced_at" IS NULL' })
@Check('CHK_billing_payment_intents_status', `"status" IN ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED', 'VOIDED')`)
@Check('CHK_billing_payment_intents_kind', `"kind" IN ('registration', 'organization', 'renewal')`)
export class BillingPaymentIntent {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_billing_payment_intents' })
  id: string;

  @Column({ type: 'varchar', length: 16 })
  provider: string;

  @Column({ type: 'varchar', length: 16 })
  kind: BillingIntentKind;

  /** What the acquirer knows the charge by: 15 characters at most (Azul's limit). */
  @Column({ name: 'order_number', type: 'varchar', length: 15 })
  orderNumber: string;

  @Column({ name: 'pending_registration_id', type: 'uuid', nullable: true })
  pendingRegistrationId: string | null;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  /** SET NULL, not CASCADE: the charge is the platform's record and outlives the customer. */
  @ManyToOne(() => Organization, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_billing_payment_intents_organization' })
  organization?: Organization | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ name: 'plan_slug', type: 'varchar', length: 64 })
  planSlug: string;

  @Column({ name: 'billing_period', type: 'varchar', length: 16, default: 'monthly' })
  billingPeriod: string;

  @Column({ type: 'char', length: 3 })
  currency: string;

  /** The total charged, ITBIS included, in minor units. */
  @Column({ name: 'amount_minor', type: 'bigint', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  amountMinor: number;

  /** The ITBIS inside `amountMinor`. */
  @Column({ name: 'tax_minor', type: 'bigint', default: 0, transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  taxMinor: number;

  @Column({ type: 'varchar', length: 16, default: BillingIntentStatus.PENDING })
  status: BillingIntentStatus;

  @Column({ name: 'success_url', type: 'text', nullable: true })
  successUrl: string | null;

  @Column({ name: 'cancel_url', type: 'text', nullable: true })
  cancelUrl: string | null;

  @Column({ name: 'authorization_code', type: 'varchar', length: 32, nullable: true })
  authorizationCode: string | null;

  /** The acquirer's own id for the transaction — what a void or refund names. */
  @Column({ name: 'provider_order_id', type: 'varchar', length: 64, nullable: true })
  providerOrderId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  rrn: string | null;

  /** The acquirer's card token (DataVault) renewals charge. Encrypted at rest. */
  @Column({ name: 'card_token', type: 'text', nullable: true, transformer: encryptedColumnTransformer })
  cardToken: string | null;

  @Column({ name: 'card_last4', type: 'varchar', length: 4, nullable: true })
  cardLast4: string | null;

  @Column({ name: 'card_brand', type: 'varchar', length: 32, nullable: true })
  cardBrand: string | null;

  /** The acquirer's answer, as received (no card data: Azul never returns the PAN). */
  @Column({ type: 'jsonb', nullable: true })
  response: Record<string, unknown> | null;

  /** The end of the period this charge paid for. */
  @Column({ name: 'period_end', type: 'timestamptz', nullable: true })
  periodEnd: Date | null;

  /** When the platform issued its own e-CF for this charge. */
  @Column({ name: 'invoiced_at', type: 'timestamptz', nullable: true })
  invoicedAt: Date | null;

  @Column({ name: 'platform_invoice_id', type: 'uuid', nullable: true })
  platformInvoiceId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
