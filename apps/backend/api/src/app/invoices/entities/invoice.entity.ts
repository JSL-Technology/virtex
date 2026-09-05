import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
  Index,
} from 'typeorm';
import { InvoiceLineItem } from './invoice-line-item.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { Currency } from '../../currencies/entities/currency.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import {
  numericTransformer,
  numericTransformerNotNull,
} from '../../common/database/numeric.transformer';

export enum InvoiceStatus {
  /** Prepared but not issued. Carries NO fiscal number and is not posted to the ledger. */
  DRAFT = 'Draft',
  /** Issued: fiscal number assigned, posted, awaiting collection. */
  PENDING = 'Pending',
  PAID = 'Paid',
  PARTIALLY_PAID = 'Partially Paid',
  /** Annulled by a full credit note, or voided before issuance. */
  VOID = 'Void',
  /** The document itself is a credit note. */
  CREDIT_NOTE = 'Credit Note',
}

export enum InvoiceType {
  INVOICE = 'INVOICE',
  CREDIT_NOTE = 'CREDIT_NOTE',
  DEBIT_NOTE = 'DEBIT_NOTE',
}

/**
 * Why a credit or debit note was issued. Mirrors the DGII `CodigoModificacion` catalogue, which is
 * mandatory on every e-CF that modifies another one; the previous code hardcoded '3' (corrects
 * amounts) even when the note annulled the document outright.
 */
export enum ModificationCode {
  /** 1 — annuls the referenced comprobante entirely. */
  ANNULMENT = '1',
  /** 2 — corrects descriptive text, amounts unchanged. */
  TEXT_CORRECTION = '2',
  /** 3 — corrects amounts. */
  AMOUNT_CORRECTION = '3',
  /** 4 — replaces a comprobante issued under contingency. */
  CONTINGENCY_REPLACEMENT = '4',
  /** 5 — reference for consumption (informative). */
  CONSUMPTION_REFERENCE = '5',
}

/**
 * How the document is settled. The two-letter values are the product's own; the DGII code they map
 * to lives in `einvoicing/config/dgii-catalogues.ts`, because the same commercial concept carries
 * different codes in different regimes.
 */
export enum PaymentMethod {
  CASH = 'CASH',
  CHECK = 'CHECK',
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  CREDIT = 'CREDIT',
  BANK_TRANSFER = 'BANK_TRANSFER',
  GIFT_CARD = 'GIFT_CARD',
  SWAP = 'SWAP',
  OTHER = 'OTHER',
}

@Entity({ name: 'invoices' })
@Index('IDX_invoices_org_issue_date', ['organizationId', 'issueDate'])
@Index('IDX_invoices_org_status', ['organizationId', 'status'])
@Index('IDX_invoices_org_customer', ['organizationId', 'customerId'])
// One fiscal number per tenant, enforced by the database rather than by hope. Re-provisioning an
// e-NCF range used to reset the counter and silently reissue numbers already on customers'
// invoices; the range-overlap check in ComplianceService now prevents it, and this index is what
// makes the guarantee hold even if a future path forgets to ask.
@Index('UQ_invoices_org_ncf', ['organizationId', 'ncfNumber'], {
  unique: true,
  where: '"ncf_number" IS NOT NULL',
})
@Index('UQ_invoices_org_number', ['organizationId', 'invoiceNumber'], { unique: true })
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  /** Internal, always-present document number from `document_sequences`. */
  @Column({ name: 'invoiceNumber' })
  invoiceNumber: string;

  /**
   * Fiscal number (NCF / e-NCF in the Dominican Republic). Null while the document is a draft and
   * in regimes that issue no fiscal number.
   */
  @Column({ name: 'ncf_number', type: 'varchar', nullable: true })
  ncfNumber?: string | null;

  /** The fiscal document type the number was drawn from (`E31`, `E32`, `B01`…). */
  @Column({ name: 'fiscal_document_type', type: 'varchar', length: 8, nullable: true })
  fiscalDocumentType?: string | null;

  /** Expiry of the DGII authorization that covers `ncfNumber`, stamped at issuance. */
  @Column({ name: 'ncf_expires_at', type: 'date', nullable: true })
  ncfExpiresAt?: string | null;

  /**
   * One customer column, with a foreign key.
   *
   * The table used to carry BOTH `"customerId" varchar NOT NULL` (from a bare `@Column()`) and
   * `customer_id uuid` (from the relation's join column): two columns holding the same fact, only
   * one of them constrained, free to diverge.
   */
  /**
   * `CASCADE`, not `RESTRICT`.
   *
   * `RESTRICT` made the tenant undeletable: `organizations` cascades to the parent and PostgreSQL
   * does not promise to clear this child first, so `DELETE FROM organizations` aborted on any
   * tenant that had ever used the feature. Refusing to delete a parent still in use belongs in the
   * owning service, which can say why.
   */
  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  /** Buyer identity as printed on the document, frozen at issuance. */
  @Column()
  customerName: string;

  @Column({ type: 'text', nullable: true })
  customerAddress?: string | null;

  @Column({ name: 'customer_tax_id', type: 'varchar', nullable: true })
  customerTaxId?: string | null;

  @Column('date')
  issueDate: string;

  @Column('date')
  dueDate: string;

  /** When the document left draft and consumed its fiscal number. */
  @Column({ name: 'issued_at', type: 'timestamptz', nullable: true })
  issuedAt?: Date | null;

  // ── Amounts, all in the transaction currency ──────────────────────────────
  //
  // Every one of these is derived server-side from the line items and is never taken from the
  // client. They are stored rather than recomputed because a fiscal document is a historical record:
  // a price list or tax rate changing tomorrow must not restate what was invoiced yesterday.

  /** Sum of line amounts net of line discounts, before document discount and tax. */
  @Column('decimal', {
    precision: 18,
    scale: 2,
    transformer: numericTransformerNotNull,
    comment: 'Subtotal in transaction currency, net of line discounts',
  })
  subtotal: number;

  /** Document-level discount. Line discounts are already reflected in `subtotal`. */
  @Column('decimal', {
    name: 'discount_total',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  discountTotal: number;

  /** Taxable base, split out because every fiscal report asks for it separately. */
  @Column('decimal', {
    name: 'taxed_total',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  taxedTotal: number;

  @Column('decimal', {
    name: 'exempt_total',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  exemptTotal: number;

  /** Amount invoiced as goods, and as services. The DGII 606/607 report the two separately. */
  @Column('decimal', {
    name: 'goods_total',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  goodsTotal: number;

  @Column('decimal', {
    name: 'services_total',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  servicesTotal: number;

  @Column('decimal', {
    precision: 18,
    scale: 2,
    transformer: numericTransformerNotNull,
    comment: 'Consumption tax (ITBIS/IVA) in transaction currency',
  })
  tax: number;

  /**
   * Legally mandated service charge — the 10 % propina legal in the Dominican Republic. Collected
   * on behalf of staff, so it is a liability, never revenue, and it is NOT part of the taxable base.
   */
  @Column('decimal', {
    name: 'service_charge',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  serviceCharge: number;

  /** Consumption tax the buyer withholds and remits on our behalf (ITBIS retenido). */
  @Column('decimal', {
    name: 'tax_withheld',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  taxWithheld: number;

  /** Income tax the buyer withholds (ISR retenido). */
  @Column('decimal', {
    name: 'income_tax_withheld',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  incomeTaxWithheld: number;

  /** Face value of the document: subtotal − discount + tax + service charge. */
  @Column('decimal', {
    precision: 18,
    scale: 2,
    transformer: numericTransformerNotNull,
    comment: 'Document total in transaction currency',
  })
  total: number;

  /** What the customer actually owes: `total` less anything they withhold at source. */
  @Column('decimal', {
    name: 'net_receivable',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  netReceivable: number;

  /** Outstanding part of `netReceivable`. */
  @Column('decimal', {
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
    comment: 'Remaining balance in transaction currency',
  })
  balance: number;

  /**
   * Total already credited against this invoice by credit notes.
   *
   * Without it, each partial credit note validated its quantities against the ORIGINAL line and
   * nothing stopped ten notes from crediting the full amount ten times.
   */
  @Column('decimal', {
    name: 'credited_total',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  creditedTotal: number;

  @Column({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.DRAFT })
  status: InvoiceStatus;

  @Column({ type: 'enum', enum: InvoiceType, default: InvoiceType.INVOICE })
  type: InvoiceType;

  @Column({
    name: 'payment_method',
    type: 'enum',
    enum: PaymentMethod,
    default: PaymentMethod.CASH,
  })
  paymentMethod: PaymentMethod;

  @OneToMany(() => InvoiceLineItem, (line) => line.invoice, { cascade: true, eager: true })
  lineItems: InvoiceLineItem[];

  @Column({ type: 'text', nullable: true })
  notes?: string;

  /** Set on a credit/debit note: the invoice it modifies. */
  @Column({ name: 'original_invoice_id', type: 'uuid', nullable: true })
  originalInvoiceId?: string | null;

  /**
   * `SET NULL`, not `RESTRICT`.
   *
   * Deleting an invoice must never delete the credit note that corrects it — between the two, the
   * correction is the record that matters more. And as `RESTRICT` it blocked tenant deletion.
   */
  @ManyToOne(() => Invoice, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'original_invoice_id' })
  originalInvoice?: Invoice | null;

  /** DGII `CodigoModificacion`, mandatory on a note that modifies another comprobante. */
  @Column({
    name: 'modification_code',
    type: 'enum',
    enum: ModificationCode,
    nullable: true,
  })
  modificationCode?: ModificationCode | null;

  /** The journal entry this document posted. Null only while the document is a draft. */
  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId?: string | null;

  /**
   * The cost-of-sale entry, posted separately because it lives in the functional currency and has
   * no foreign-exchange exposure, unlike the revenue side.
   */
  @Column({ name: 'cost_journal_entry_id', type: 'uuid', nullable: true })
  costJournalEntryId?: string | null;

  @Column({ name: 'voided_at', type: 'timestamptz', nullable: true })
  voidedAt?: Date | null;

  @Column({ name: 'void_reason', type: 'text', nullable: true })
  voidReason?: string | null;

  @Column({ length: 3, default: 'USD', name: 'currency_code' })
  currencyCode: string;

  @ManyToOne(() => Currency)
  @JoinColumn({ name: 'currency_code', referencedColumnName: 'code' })
  currency: Currency;

  @Column('decimal', {
    precision: 18,
    scale: 6,
    default: 1.0,
    name: 'exchange_rate',
    transformer: numericTransformerNotNull,
    comment: 'Rate to convert from transaction currency to base currency',
  })
  exchangeRate: number;

  @Column('decimal', {
    precision: 18,
    scale: 2,
    name: 'total_in_base_currency',
    transformer: numericTransformerNotNull,
    comment: "Total amount converted to the organization's base currency",
  })
  totalInBaseCurrency: number;

  /** Cost of the goods that left inventory, in base currency — the other half of the margin. */
  @Column('decimal', {
    name: 'cost_of_sale',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  costOfSale: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @VersionColumn()
  version: number;

  /** True once the document carries an electronic fiscal number that must reach the DGII. */
  get isElectronicFiscalDocument(): boolean {
    return Boolean(this.ncfNumber && this.ncfNumber.toUpperCase().startsWith('E'));
  }

  /** Amount still creditable by a credit note, in transaction currency. */
  get creditableRemaining(): number {
    return round2(this.total - this.creditedTotal);
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Nullable numeric helper kept beside the entity so callers can reuse the same rounding rule. */
export { numericTransformer };
