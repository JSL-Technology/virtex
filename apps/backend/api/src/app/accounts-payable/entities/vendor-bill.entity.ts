
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
  VersionColumn,
  CreateDateColumn,
  UpdateDateColumn, Index } from 'typeorm';
import { VendorBillLine } from './vendor-bill-line.entity';
import { Supplier } from '../../suppliers/entities/supplier.entity';
import { Currency } from '../../currencies/entities/currency.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { JournalEntry } from '../../journal-entries/entities/journal-entry.entity';
import { numericTransformerNotNull, numericTransformerWithDefault } from '../../common/database/numeric.transformer';
import { PurchaseOrder } from '../../procurement/entities/purchase-order.entity';
import { BranchRef, IssuedAtBranch } from '../../organizations/contracts/branch.contract';

export enum VendorBillStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  /**
   * Held by the three-way match (audit 2026-11-07, CMP-01): it bills more than was received, or a
   * price outside the tolerance of the order. Not posted and not payable until someone other than
   * the submitter releases it with a reason.
   */
  ON_HOLD = 'ON_HOLD',
  OPEN = 'OPEN',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  VOID = 'VOID',
  REJECTED = 'REJECTED',
}

/** One discrepancy between a bill line and its purchase-order line (CMP-01). */
export interface MatchException {
  kind: 'QUANTITY' | 'PRICE';
  purchaseOrderLineId: string;
  description: string;
  /** QUANTITY: billed vs received-and-not-yet-billed. PRICE: billed unit price vs the order's. */
  billed: number;
  expected: number;
}

@Index('IDX_vendor_bills_org_branch', ['organizationId', 'branchId'])
// One live bill per supplier document number, in every country (AP-03). Voided and rejected bills
// leave the index, so a document entered by mistake can be entered again correctly.
@Index('UQ_vendor_bills_supplier_invoice', ['organizationId', 'vendorId', 'supplierInvoiceKey'], {
  unique: true,
  where: `"supplier_invoice_key" IS NOT NULL AND "status" NOT IN ('VOID', 'REJECTED')`,
})
// One live bill per (issuer tax id, fiscal document number) — not per supplier record, which could
// be duplicated (audit 2026-11-07, CMP-03/CMP-04). Both keys are kept by a database trigger, so an
// import or direct SQL cannot skip the rule the service checks.
@Index('UQ_vendor_bills_issuer_fiscal_number', ['organizationId', 'issuerTaxKey', 'supplierFiscalKey'], {
  unique: true,
  where: `"issuer_tax_key" IS NOT NULL AND "supplier_fiscal_key" IS NOT NULL AND "status" NOT IN ('VOID', 'REJECTED')`,
})
@Entity({ name: 'vendor_bills' })
export class VendorBill {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  /** The branch this was issued from — see `IssuedAtBranch`. Null for a company without branches, and for documents that predate them. */
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @IssuedAtBranch('FK_vendor_bills_branch')
  branch?: BranchRef | null;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  // ON DELETE RESTRICT (QA C-03): a document outlives any change of mind about the master data it
  // names. See migration ProtectReferencedMasterData.
  @ManyToOne(() => Supplier, { eager: true, onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
  @JoinColumn({ name: 'vendor_id' })
  vendor: Supplier;

  @Column({ name: 'vendor_id' })
  vendorId: string;

  /** The purchase order this bill was raised against, if any (three-way match, QA C-07). */
  @Column({ name: 'purchase_order_id', type: 'uuid', nullable: true })
  purchaseOrderId?: string | null;

  @ManyToOne(() => PurchaseOrder, { nullable: true, onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
  @JoinColumn({ name: 'purchase_order_id', foreignKeyConstraintName: 'FK_vendor_bills_purchase_order' })
  purchaseOrder?: PurchaseOrder | null;

  /**
   * The number the authority assigned to the supplier's document: a Dominican NCF, a Mexican folio
   * fiscal, a Brazilian chave de acesso, a Colombian CUFE. What it is in each market, and how it is
   * checked, is the market's own (`MarketPurchases.receivedDocument`).
   *
   * It was `ncf`, the DGII's name for it, on every purchase of every market.
   */
  @Column({ name: 'supplier_fiscal_number', type: 'varchar', nullable: true })
  supplierFiscalNumber?: string | null;

  /** `supplierFiscalNumber` normalized, and the issuer's tax id; written by the database trigger. */
  // Wide enough for the longest number any market issues: a 96-character CUFE, a 44-digit NF-e
  // access key. It was 40 — the length of an NCF and a little — so the first Colombian or Brazilian
  // purchase would have failed on insert.
  @Column({ name: 'supplier_fiscal_key', type: 'varchar', length: 128, nullable: true, insert: false, update: false, select: false })
  supplierFiscalKey?: string | null;

  @Column({ name: 'issuer_tax_key', type: 'varchar', length: 40, nullable: true, insert: false, update: false, select: false })
  issuerTaxKey?: string | null;

  /**
   * The number the supplier printed on their invoice (AP-03).
   *
   * The NCF identifies a Dominican document; nothing identified one anywhere else, so the same
   * supplier invoice could be recorded — and paid — twice in every other market, and in the
   * Dominican Republic whenever the document carried no NCF.
   */
  /** The warehouse the bill's own goods entered, so a void takes them back out of it (AP-05). */
  @Column({ name: 'receipt_warehouse_id', type: 'uuid', nullable: true })
  receiptWarehouseId?: string | null;

  @Column({ name: 'supplier_invoice_number', type: 'varchar', length: 60, nullable: true })
  supplierInvoiceNumber?: string | null;

  /** `supplierInvoiceNumber` normalised for comparison (see `supplierInvoiceKey()`); never sent. */
  @Column({ name: 'supplier_invoice_key', type: 'varchar', length: 60, nullable: true, select: false })
  supplierInvoiceKey?: string | null;

  /**
   * The date on the supplier's document, and the date it falls due — calendar dates, not instants.
   *
   * Both were `@Column() date: Date`, which reflect-metadata resolves to `timestamp`, so a bill
   * dated the 14th was stored as the 14th at 00:00 and served as `2026-09-14T00:00:00.000Z`. The
   * browser then rendered that instant in the tenant's zone — `America/Santo_Domingo`, UTC−4 — and
   * every supplier bill in the product showed the day before, on the document, in the list and on
   * the 606. A document date has no time to convert: `date` is the column type that says so, and a
   * `string` keeps it a calendar date all the way to the client.
   */
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'date' })
  dueDate: string;

  @OneToMany(() => VendorBillLine, (line) => line.vendorBill, { cascade: true })
  lines: VendorBillLine[];

  /**
   * The number of the supplier's document this one modifies, on a credit or debit note they issued.
   * A purchases return has a column for it, and it was never captured.
   */
  @Column({ name: 'modified_supplier_fiscal_number', type: 'varchar', nullable: true })
  modifiedSupplierFiscalNumber?: string | null;

  /** When the bill was actually paid; the 606 reports it separately from the document date. */
  @Column({ name: 'paid_at', type: 'date', nullable: true })
  paidAt?: string | null;

  // ── Fiscal breakdown ───────────────────────────────────────────────────────
  //
  // `total` alone cannot produce a compliant 606. The report asks for goods and services
  // separately, for the tax actually borne, for what was withheld and for the excise and other
  // levies. Deriving them by dividing the total by 1.18 — which is what the previous report did —
  // assumes every purchase is taxable at the standard rate and is wrong for exempt purchases,
  // services subject to withholding, and anything bearing excise.

  @Column('decimal', {
    name: 'services_amount',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  servicesAmount: number;

  @Column('decimal', {
    name: 'goods_amount',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  goodsAmount: number;

  /** Consumption tax borne on the purchase (ITBIS facturado). */
  @Column('decimal', {
    name: 'tax_amount',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  taxAmount: number;

  /** Consumption tax we withheld from the supplier and must remit. */
  @Column('decimal', {
    name: 'tax_withheld',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  taxWithheld: number;

  /** Income tax withheld from the supplier. */
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
   * Recorded so a filing can be traced back to the rule that generated it — the same audit trail
   * the sales side already kept, and which the purchase side did not, because the purchase side
   * did not resolve anything: both amounts came off the request verbatim.
   *
   * Empty when nothing was withheld, and also when the tenant overrode the regime, in which case
   * `withholdingOverrideReason` carries the justification instead.
   */
  @Column({ name: 'withholding_regime_codes', type: 'text', array: true, default: '{}' })
  withholdingRegimeCodes: string[];

  /**
   * Why this bill withheld something other than what its regime produces.
   *
   * Null on an ordinary bill. Non-null is not an error — a market this product does not model, a
   * designation that changed this week — but it is a decision somebody made, and it belongs on
   * the document.
   */
  @Column({ name: 'withholding_override_reason', type: 'text', nullable: true })
  withholdingOverrideReason: string | null;

  /** Why the tax differs from what the lines' rates produce, when it does (CMP-02). */
  @Column({ name: 'tax_override_reason', type: 'text', nullable: true })
  taxOverrideReason: string | null;

  /** Consumption tax that cannot be deducted and is carried to cost. */
  @Column('decimal', {
    name: 'tax_to_cost',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  taxToCost: number;

  /** Consumption tax subject to the proportionality rule (Art. 349). */
  @Column('decimal', {
    name: 'tax_proportional',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  taxProportional: number;

  @Column('decimal', {
    name: 'excise_amount',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  exciseAmount: number;

  @Column('decimal', {
    name: 'other_taxes',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  otherTaxes: number;

  @Column('decimal', {
    name: 'service_charge',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  serviceCharge: number;

  /**
   * What this market's authority asks of the purchase beyond its figures and its document, by the
   * keys the market declares (`MarketPurchases.fiscalAttributes`): the Dominican 606's kind of goods
   * or services and kind of income-tax withholding, the Mexican DIOT's kind of third party.
   *
   * Three columns held the DGII's codes — `purchase_category`, `isr_retention_type`, `payment_form` —
   * on every purchase of every market, and a market that asked for anything else had nowhere to put
   * it. What is asked for is validated against the market's schema before this is written, so the
   * column never holds a key its market does not ask for.
   */
  @Column({ name: 'fiscal_attributes', type: 'jsonb', default: {} })
  fiscalAttributes: Record<string, string>;

  /**
   * Which of the company's payment methods settled it (`payment_methods.code`), as the invoice
   * records on the sales side. The authority's own code for it, where a return asks for one, is the
   * method's `fiscal_code`: this was the DGII's «forma de pago» written straight onto the purchase.
   */
  @Column({ name: 'payment_method_code', type: 'varchar', length: 20, nullable: true })
  paymentMethodCode?: string | null;

  @Column('decimal', { precision: 12, scale: 2, transformer: numericTransformerNotNull })
  total: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0.0, transformer: numericTransformerNotNull })
  balance: number;

  @Column({
    type: 'enum',
    enum: VendorBillStatus,
    default: VendorBillStatus.DRAFT,
  })
  status: VendorBillStatus;

  @Column({ type: 'uuid', name: 'approval_request_id', nullable: true })
  approvalRequestId?: string;

  /** What the three-way match found when the bill was submitted (CMP-01); null when nothing. */
  @Column({ name: 'match_exceptions', type: 'jsonb', nullable: true })
  matchExceptions: MatchException[] | null;

  /** Who submitted the held bill: the one person who may not release it. */
  @Column({ name: 'match_held_by', type: 'uuid', nullable: true })
  matchHeldBy: string | null;

  @Column({ name: 'match_released_by', type: 'uuid', nullable: true })
  matchReleasedBy: string | null;

  @Column({ name: 'match_released_at', type: 'timestamptz', nullable: true })
  matchReleasedAt: Date | null;

  @Column({ name: 'match_release_reason', type: 'text', nullable: true })
  matchReleaseReason: string | null;

  /**
   * The entry that put this bill in the ledger, and the one that took it out.
   *
   * Neither was recorded, which is why annulling a bill could not reverse it: `voidBill` marked the
   * document VOID, zeroed its balance and emitted `vendor.bill.voided` — an event with no listener
   * anywhere in the repository — leaving the payable and the expense in the general ledger for
   * good. The subledger said the bill was annulled and the books said it was owed, permanently, and
   * no report compared the two. The credit note side of sales has always reversed properly; this
   * is the same treatment.
   */
  @Column({ type: 'uuid', name: 'journal_entry_id', nullable: true })
  journalEntryId: string | null;

  // Declared as relations, not bare uuid columns, so the foreign keys are part of the entity's
  // description of itself and `check:schema-drift` can see them. `SET NULL`, never `CASCADE`:
  // removing a journal entry must not remove the commercial document that produced it.
  @ManyToOne(() => JournalEntry, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'journal_entry_id',
    foreignKeyConstraintName: 'FK_vendor_bills_journal_entry',
  })
  journalEntry?: JournalEntry | null;

  @Column({ type: 'uuid', name: 'reversal_journal_entry_id', nullable: true })
  reversalJournalEntryId: string | null;

  @ManyToOne(() => JournalEntry, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'reversal_journal_entry_id',
    foreignKeyConstraintName: 'FK_vendor_bills_reversal_entry',
  })
  reversalJournalEntry?: JournalEntry | null;

  @Column({ type: 'text', name: 'void_reason', nullable: true })
  voidReason: string | null;

  @Column({ type: 'timestamptz', name: 'voided_at', nullable: true })
  voidedAt: Date | null;

  @Column({ type: 'uuid', name: 'voided_by_user_id', nullable: true })
  voidedByUserId: string | null;


  @Column({ length: 3, default: 'USD', name: 'currency_code' })
  currencyCode: string;

  @ManyToOne(() => Currency)
  @JoinColumn({ name: 'currency_code', referencedColumnName: 'code' })
  currency: Currency;

  @Column('decimal', { precision: 18, scale: 6, default: 1.0, name: 'exchange_rate', transformer: numericTransformerWithDefault })
  exchangeRate: number;

  @Column('decimal', { precision: 18, scale: 2, name: 'total_in_base_currency', transformer: numericTransformerNotNull })
  totalInBaseCurrency: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;


  @VersionColumn()
  version: number;
}