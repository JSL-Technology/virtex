import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { Organization } from '../../organizations/entities/organization.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { User } from '../../users/entities/user.entity/user.entity';
import { Opportunity } from './opportunity.entity';
import { QuoteLine } from './quote-line.entity';
import { Currency } from '../../currencies/entities/currency.entity';
import { BranchRef, IssuedAtBranch } from '../../organizations/contracts/branch.contract';

export enum QuoteStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  INVOICED = 'INVOICED',
  /** Withdrawn before the customer answered. Kept, numbered, never deleted. */
  CANCELLED = 'CANCELLED',
}

// The number is unique per tenant, like every other document number. It was unique across the
// whole platform, so two companies could not both have a «COT-2026-000001».
@Index('UQ_quotes_org_number', ['organizationId', 'quoteNumber'], { unique: true })
@Index('IDX_quotes_org_branch', ['organizationId', 'branchId'])
@Entity({ name: 'quotes' })
export class Quote {
  @PrimaryGeneratedColumn('uuid')
  id: string;


  /**
   * `uuid`, matching `organizations.id`, with a foreign key.
   *
   * Twenty tables held the tenant reference as `character varying` while the column it points at
   * is a uuid. A join between them was a type error PostgreSQL refused outright, and a row whose
   * organization had been deleted was perfectly storable.
   */
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** The branch this was issued from — see `IssuedAtBranch`. Null for a company without branches, and for documents that predate them. */
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @IssuedAtBranch('FK_quotes_branch')
  branch?: BranchRef | null;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column()
  quoteNumber: string;

  /**
   * `CASCADE`, explicitly.
   *
   * The default is `NO ACTION`, which made the tenant undeletable: `organizations` cascades to
   * `customers` and PostgreSQL does not promise to clear the quotes first.
   */
  // ON DELETE RESTRICT (QA C-03): a document outlives any change of mind about the master data it
  // names. See migration ProtectReferencedMasterData.
  @ManyToOne(() => Customer, { eager: true, onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @ManyToOne(() => Opportunity, { nullable: true, onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
  @JoinColumn({ name: 'opportunity_id' })
  opportunity?: Opportunity;

  @OneToMany(() => QuoteLine, (line) => line.quote, { cascade: true, eager: true })
  lines: QuoteLine[];

  @Column({ type: 'date' })
  issueDate: Date;

  @Column({ type: 'date' })
  expiryDate: Date;

  @Column('decimal', { precision: 18, scale: 2, comment: 'Subtotal in transaction currency', transformer: numericTransformerNotNull })
  subtotal: number;

  /** Line discounts plus the document discount. */
  @Column('decimal', { name: 'discount_total', precision: 18, scale: 2, default: 0, transformer: numericTransformerNotNull })
  discountTotal: number;

  /**
   * The tax the invoice will charge, computed by the same engine as the invoice. A quote without
   * it promised the customer a price the invoice then raised by the ITBIS.
   */
  @Column('decimal', { name: 'tax_total', precision: 18, scale: 2, default: 0, transformer: numericTransformerNotNull })
  taxTotal: number;

  @Column('decimal', { precision: 18, scale: 2, comment: 'Total in transaction currency', transformer: numericTransformerNotNull })
  total: number;

  @Column('decimal', { name: 'document_discount_rate', precision: 7, scale: 6, default: 0, transformer: numericTransformerNotNull })
  documentDiscountRate: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt: Date | null;

  /** What the customer said, or why it was withdrawn. */
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  /** The invoice this quote became. */
  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoiceId: string | null;
  

  @Column({ length: 3, name: 'currency_code' })
  currencyCode: string;

  @ManyToOne(() => Currency)
  @JoinColumn({ name: 'currency_code', referencedColumnName: 'code' })
  currency: Currency;

  @Column('decimal', {
    precision: 18,
    scale: 6,
    default: 1.0,
    name: 'exchange_rate',
    comment: 'Rate to convert from transaction currency to base currency'
  })
  exchangeRate: number;

  @Column('decimal', {
    precision: 18,
    scale: 2,
    name: 'total_in_base_currency',
    comment: 'Total amount converted to the organization\'s base currency'
  })
  totalInBaseCurrency: number;


  @Column({ type: 'enum', enum: QuoteStatus, default: QuoteStatus.DRAFT })
  status: QuoteStatus;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}