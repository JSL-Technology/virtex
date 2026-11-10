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
  Check,
} from 'typeorm';
import { InvoiceLineItem } from './invoice-line-item.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { Currency } from '../../currencies/entities/currency.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { numericTransformer, numericTransformerNotNull, numericTransformerWithDefault } from '../../common/database/numeric.transformer';
import { roundToCurrency } from '../../common/money';
import { BranchRef, IssuedAtBranch } from '../../organizations/contracts/branch.contract';

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

/**
 * Why a debit note adds to an invoice — the product's own taxonomy (FAC-INV-05), which every regime
 * maps to its authority's catalogue: DGII CodigoModificacion, DIAN concepto de corrección, SUNAT
 * catálogo 10, SII código de referencia.
 */
export enum DebitNoteReason {
  /** Interest for paying late. */
  LATE_PAYMENT_INTEREST = 'LATE_PAYMENT_INTEREST',
  /** Charges billed afterwards: freight, insurance, expenses incurred for the customer. */
  ADDITIONAL_CHARGES = 'ADDITIONAL_CHARGES',
  /** The agreed value of the original operation goes up. */
  PRICE_INCREASE = 'PRICE_INCREASE',
  PENALTY = 'PENALTY',
  OTHER = 'OTHER',
}

/** How a VOID document came to be void. */
export enum CancellationMode {
  /** A commercial document the authority never saw, voided because nothing had touched it. */
  VOID = 'VOID',
  /** Annulled by the issuer and declared to the authority (the Dominican 608). */
  REPORTED = 'REPORTED',
  /** Reversed in full by a credit note: still the sale it was, corrected by the note. */
  CREDIT_NOTE = 'CREDIT_NOTE',
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

@Index('IDX_invoices_org_branch', ['organizationId', 'branchId'])
@Entity({ name: 'invoices' })
@Check('CHK_invoices_adjustment_reason', `"adjustment_reason" IS NULL OR "adjustment_reason" IN ('LATE_PAYMENT_INTEREST', 'ADDITIONAL_CHARGES', 'PRICE_INCREASE', 'PENALTY', 'OTHER')`)
@Check('CHK_invoices_cancellation_mode', `"cancellation_mode" IS NULL OR "cancellation_mode" IN ('VOID', 'REPORTED', 'CREDIT_NOTE')`)
@Index('IDX_invoices_org_issue_date', ['organizationId', 'issueDate'])
@Index('IDX_invoices_org_status', ['organizationId', 'status'])
@Index('IDX_invoices_org_customer', ['organizationId', 'customerId'])
// One fiscal number per tenant, enforced by the database rather than by hope. Re-provisioning a
// range used to reset the counter and silently reissue numbers already on customers' invoices; the
// overlap check in FiscalRangeService.register prevents it, and this index is what makes the
// guarantee hold even if a future path forgets to ask.
@Index('UQ_invoices_org_fiscal_number', ['organizationId', 'fiscalNumber'], {
  unique: true,
  where: '"fiscal_number" IS NOT NULL',
})
@Index('UQ_invoices_org_number', ['organizationId', 'invoiceNumber'], { unique: true })
// The numbers already drawn from a range, for registering a new range that must not overlap them
// and for matching a document to the range it came from.
@Index('IDX_invoices_fiscal_sequence', ['organizationId', 'fiscalDocumentType', 'fiscalSeries', 'fiscalSequence'], {
  where: '"fiscal_sequence" IS NOT NULL',
})
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  /** The branch this was issued from — see `IssuedAtBranch`. Null for a company without branches, and for documents that predate them. */
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @IssuedAtBranch('FK_invoices_branch')
  branch?: BranchRef | null;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  /** Internal, always-present document number from `document_sequences`. */
  @Column({ name: 'invoiceNumber' })
  invoiceNumber: string;

  /**
   * The number the tax authority's series assigned to this document.
   *
   * Called `ncf_number` until now — "Número de Comprobante Fiscal", a DGII term — on a column that
   * holds the folio of a Mexican CFDI, the número of a Chilean DTE and the chave de acesso of a
   * Brazilian NF-e just as readily. The comment already conceded the point ("NCF / e-NCF **in the
   * Dominican Republic**"): the semantics had generalised and the name had not.
   *
   * Null while the document is a draft, and in regimes that issue no fiscal number at all.
   */
  @Column({ name: 'fiscal_number', type: 'varchar', nullable: true })
  fiscalNumber?: string | null;

  /** The fiscal document type the number was drawn from (`E31`, `E32`, `B01`…). */
  @Column({ name: 'fiscal_document_type', type: 'varchar', length: 8, nullable: true })
  fiscalDocumentType?: string | null;

  /** Expiry of the authorization that covers `fiscalNumber`, stamped at issuance. */
  @Column({ name: 'fiscal_number_expires_at', type: 'date', nullable: true })
  fiscalNumberExpiresAt?: string | null;

  /**
   * The consecutive the number was drawn as, from the tenant's authorised range, and that range's
   * series (`''` where the market numbers without one).
   *
   * Recorded at issuance so nothing reads them back out of the formatted number: the authority's
   * mask decides how `fiscalNumber` is written, and a prefix that carries a digit (`FE2` + `1001`)
   * cannot be parsed back into its parts. A range is checked against the numbers already issued
   * from it, and an e-invoicing builder writes the consecutive, from these two columns. Null where
   * the number was not drawn from a range — a stamp, the authority's own counter, no fiscal number.
   */
  @Column({ name: 'fiscal_sequence', type: 'bigint', nullable: true, transformer: numericTransformer })
  fiscalSequence?: number | null;

  @Column({ name: 'fiscal_series', type: 'varchar', length: 16, nullable: true })
  fiscalSeries?: string | null;

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
  // ON DELETE RESTRICT (QA C-03): a document outlives any change of mind about the master data it
  // names. See migration ProtectReferencedMasterData.
  @ManyToOne(() => Customer, { onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
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

  /**
   * Which withholding regimes produced the two figures above.
   *
   * Recorded so a filing can be traced back to the rule that generated it. Nothing did: the rates
   * arrived on the request and the document kept only their result, so a return that reported a
   * withholding could not say on what authority it had been taken.
   *
   * Empty when nothing was withheld, and also when the tenant overrode the regime — in which case
   * `withholdingOverrideReason` carries the justification instead.
   */
  @Column({ name: 'withholding_regime_codes', type: 'text', array: true, default: '{}' })
  withholdingRegimeCodes: string[];

  /**
   * Why this document withheld something other than what its regime produces.
   *
   * Null on an ordinary document. Non-null is not an error — a market this product does not model,
   * a designation that changed this week — but it is a decision somebody made, and it is on the
   * document rather than in a log that rotates.
   */
  @Column({ name: 'withholding_override_reason', type: 'text', nullable: true })
  withholdingOverrideReason: string | null;

  /**
   * How the tax rate was determined, in a market that has no national rate.
   *
   * The United States and Brazil levy sub-nationally: what a buyer pays is the sum of a state,
   * county, city and special-district rate at the delivery address, and a seller collects nothing
   * at all in a state it is not registered in. Until now the client sent a rate and nothing
   * checked it.
   *
   * Recorded per document because a return is filed per jurisdiction: without it, "which of these
   * sales was Dallas and which was Houston" is unanswerable, and `NO_NEXUS` — a sale correctly
   * untaxed — is indistinguishable from a sale somebody forgot to tax.
   *
   * Null in every market whose rate comes from a table.
   */
  @Column({ name: 'tax_determination', type: 'jsonb', nullable: true })
  taxDetermination: {
    outcome: string;
    rate: number;
    source: string;
    components?: { level: string; name: string; rate: number }[];
    reasonKey?: string;
  } | null;

  /**
   * Excise duty (ISC / IEPS / ICE) charged on the document.
   *
   * Part of `total` and, until now, stored nowhere — so the ledger entry could not name the
   * liability and the 607's `MontoISC` column had nothing to read.
   */
  @Column('decimal', {
    name: 'excise',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  excise: number;

  /** Face value of the document: subtotal − discount + tax + excise + service charge. */
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

  /**
   * Which of the company's payment methods (`payment_methods.code`) it was paid with — «ZELLE»,
   * «ACH» — where `payment_method` only says how it settles. Null on documents that named only the
   * kind, which is every document before country packs (QA C-06) and every Dominican one, whose
   * e-CF form of payment is the kind.
   */
  @Column({ name: 'payment_method_code', type: 'varchar', length: 20, nullable: true })
  paymentMethodCode?: string | null;

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

  /**
   * Why a debit note adds to the invoice it modifies, in the product's own terms (FAC-INV-05). Each
   * regime translates it into its authority's code; the core never stores one market's code.
   */
  @Column({ name: 'adjustment_reason', type: 'varchar', length: 32, nullable: true })
  adjustmentReason?: DebitNoteReason | null;

  /**
   * How a VOID document came to be void (FAC-INV-05): voided as a commercial document, annulled and
   * declared to the authority, or reversed in full by a credit note. A fiscal return reads it — an
   * invoice reversed by a credit note is still a sale of its month; an annulled one is not.
   */
  @Column({ name: 'cancellation_mode', type: 'varchar', length: 16, nullable: true })
  cancellationMode?: CancellationMode | null;

  /**
   * The authority's reason code, where its catalogue has one (`fiscal_reason_codes`): the
   * Dominican 608 codes. Checked by the database against the tenant's country.
   */
  @Column({ name: 'cancellation_reason_code', type: 'varchar', length: 16, nullable: true })
  cancellationReasonCode?: string | null;

  /** The entries that reversed it when it was cancelled without a credit note. */
  @Column({ name: 'cancellation_journal_entry_id', type: 'uuid', nullable: true })
  cancellationJournalEntryId?: string | null;

  @Column({ name: 'cancellation_cost_journal_entry_id', type: 'uuid', nullable: true })
  cancellationCostJournalEntryId?: string | null;

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
    transformer: numericTransformerWithDefault,
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

  /**
   * True once the document carries a Dominican e-NCF that must reach the DGII.
   *
   * By the DGII's own shapes — an `E` and two digits of type, then ten of sequence — and by the
   * recorded type when there is one. It used to be "starts with E", which also matched a Colombian
   * number under a DIAN prefix such as `ELEC123` and would have queued it for the DGII.
   */
  get isElectronicFiscalDocument(): boolean {
    const number = (this.fiscalNumber ?? '').toUpperCase();
    if (!/^E\d{12}$/.test(number)) return false;
    return this.fiscalDocumentType ? /^E\d{2}$/.test(this.fiscalDocumentType.toUpperCase()) : true;
  }

  /** Amount still creditable by a credit note, in transaction currency. */
  get creditableRemaining(): number {
    return roundToCurrency(this.total - this.creditedTotal, this.currencyCode);
  }
}

/** Nullable numeric helper kept beside the entity so callers can reuse the same rounding rule. */
export { numericTransformer };
