
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  Index,
  RelationId,
  ManyToOne,
} from 'typeorm';
import { Organization } from './organization.entity';
import { ExchangeRateType } from '../../currencies/entities/exchange-rate.entity';
import { TaxpayerType } from '../../localization/fiscal/withholding-regimes';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

const DEFAULT_BASE_CURRENCY = 'USD' as const;

@Index('ux_organization_settings_organization_id', ['organizationId'], { unique: true })
@Entity({ name: 'organization_settings' })
export class OrganizationSettings {
  constructor(partial?: Partial<OrganizationSettings>) {
    if (partial) Object.assign(this, partial);
  }


  @PrimaryGeneratedColumn('uuid')
  id!: string;


  @OneToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: Organization;


  @RelationId((s: OrganizationSettings) => s.organization)
  @Column({ name: 'organization_id' })
  organizationId!: string;





  @Column({ name: 'base_currency', length: 3, default: DEFAULT_BASE_CURRENCY })
  baseCurrency!: string;

  /**
   * The default credit period, in days, for a customer who has none of their own.
   *
   * Zero — due on receipt — is the safe default rather than a guess at thirty: a tenant that sells
   * on credit sets this once, and one that does not is not told its invoices are overdue tomorrow
   * because the product assumed terms nobody agreed to.
   */
  @Column({ name: 'default_payment_term_days', type: 'int', default: 0 })
  defaultPaymentTermDays!: number;

  /**
   * Which published rate this tenant keeps its books at.
   *
   * A currency pair does not have *a* rate on a day. Colombia's TRM, Mexico's DOF FIX and the
   * Dominican Republic's DGII rate are each the mandatory accounting rate in their jurisdiction,
   * and each differs from the interbank mid a market data provider quotes. Every rate the product
   * stored was a market mid, used as though it were the official one; a tenant obliged to book at
   * the authority's rate had no way to say so.
   */
  @Column({
    name: 'exchange_rate_type',
    type: 'enum',
    enum: ExchangeRateType,
    default: ExchangeRateType.OFFICIAL,
  })
  exchangeRateType!: ExchangeRateType;





  @Column({ name: 'default_inventory_id', type: 'uuid', nullable: true })
  defaultInventoryId: string | null = null;





  @Column({ name: 'default_accounts_receivable_id', type: 'uuid', nullable: true })
  defaultAccountsReceivableId: string | null = null;

  @Column({ name: 'default_accounts_payable_id', type: 'uuid', nullable: true })
  defaultAccountsPayableId: string | null = null;

  @Column({ name: 'default_sales_revenue_id', type: 'uuid', nullable: true })
  defaultSalesRevenueId: string | null = null;

  @Column({ name: 'default_sales_tax_id', type: 'uuid', nullable: true })
  defaultSalesTaxId: string | null = null;

  /**
   * Excise duty charged on sales (ISC, IEPS, ICE) — a liability distinct from the consumption tax.
   *
   * `computeDocument` has always returned `excise`, and the invoice stored it nowhere: it was
   * inside `total` and in no account, so the sales entry was out of balance by the excise on every
   * document subject to one, and the posting was refused with a message about arithmetic.
   */
  @Column({ name: 'default_excise_tax_payable_id', type: 'uuid', nullable: true })
  defaultExciseTaxPayableId: string | null = null;

  /**
   * The tenant's own fiscal classification, as the seller.
   *
   * Withholding depends on both parties, and assuming the seller is a company is wrong for a large
   * part of this product's market: a *negocio de único dueño* in the Dominican Republic, a
   * *persona natural con RUC* in Peru or Ecuador, a *monotributista* in Argentina is a natural
   * person for withholding purposes, and their corporate customers withhold from them at rates
   * that do not apply between companies — in the Dominican case 100 % of the ITBIS rather than
   * nothing. Assuming COMPANY would silently under-withhold on every one of their invoices.
   *
   * Null means unstated, and the resolver then treats the tenant as a company, which is the
   * classification of every tenant that holds a fiscal document range in its own corporate name.
   */
  @Column({ name: 'taxpayer_type', type: 'varchar', length: 24, nullable: true })
  taxpayerType?: TaxpayerType | null;

  /**
   * The relation behind the column above, declared only so the foreign key is part of the model.
   *
   * The other `default_*_id` columns carry no constraint, and a settings row pointing at an
   * account somebody has since deleted is exactly how a posting fails at 2 a.m. with a message
   * about a missing account. This one is constrained — `ON DELETE SET NULL`, so removing the
   * account clears the setting rather than blocking the delete — and TypeORM has to know about it
   * or the schema-drift check proposes dropping it on every run.
   */
  @ManyToOne('Account', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'default_excise_tax_payable_id',
    foreignKeyConstraintName: 'FK_organization_settings_excise_tax_payable',
  })
  defaultExciseTaxPayable?: unknown;

  /** VAT/ITBIS borne on purchases — the recoverable side of the tax return. */
  @Column({ name: 'default_purchase_tax_id', type: 'uuid', nullable: true })
  defaultPurchaseTaxId: string | null = null;

  @Column({ name: 'default_service_revenue_id', type: 'uuid', nullable: true })
  defaultServiceRevenueId: string | null = null;

  /**
   * Cost of goods sold. A sale posts revenue AND the cost of what left the warehouse; without this
   * account the margin never reaches the income statement and inventory drifts from the ledger.
   */
  @Column({ name: 'default_cost_of_goods_sold_id', type: 'uuid', nullable: true })
  defaultCostOfGoodsSoldId: string | null = null;

  /** Contra-revenue account for commercial discounts granted on a sales document. */
  @Column({ name: 'default_sales_discounts_id', type: 'uuid', nullable: true })
  defaultSalesDiscountsId: string | null = null;

  /**
   * Legally mandated service charge (propina legal, 10 % in the Dominican Republic). It is
   * collected on behalf of staff and is never revenue, so it posts to a liability.
   */
  @Column({ name: 'default_service_charge_payable_id', type: 'uuid', nullable: true })
  defaultServiceChargePayableId: string | null = null;

  /** Tax withheld from us by a customer, recoverable against our own return. */
  @Column({ name: 'default_tax_withheld_receivable_id', type: 'uuid', nullable: true })
  defaultTaxWithheldReceivableId: string | null = null;

  /** Tax we withhold from a third party and must remit. */
  @Column({ name: 'default_tax_withheld_payable_id', type: 'uuid', nullable: true })
  defaultTaxWithheldPayableId: string | null = null;

  @Column({ name: 'default_cash_id', type: 'uuid', nullable: true })
  defaultCashId: string | null = null;

  @Column({ name: 'default_bank_id', type: 'uuid', nullable: true })
  defaultBankId: string | null = null;

  @Column({ name: 'default_retained_earnings_account_id', type: 'uuid', nullable: true })
  defaultRetainedEarningsAccountId: string | null = null;

  /**
   * Where a collection with nothing applied to it is held.
   *
   * A liability, not a negative receivable: see `AccountRole.CUSTOMER_ADVANCES`. Crediting the
   * receivable control account instead drove it below zero and broke the ageing report's own
   * reconciliation by exactly the amount held in advance.
   */
  @Column({ name: 'default_customer_advances_account_id', type: 'uuid', nullable: true })
  defaultCustomerAdvancesAccountId: string | null = null;

  /**
   * The counterpart for balances that predate the books — opening stock above all.
   *
   * Deliberately NOT retained earnings: a stock count carried over from the previous system is not
   * a result this company earned, and posting it there misstates every equity figure after it.
   */
  @Column({ name: 'default_opening_balance_equity_account_id', type: 'uuid', nullable: true })
  defaultOpeningBalanceEquityAccountId: string | null = null;

  /**
   * Where a stock movement that is neither a purchase nor a sale is recognised.
   *
   * See `AccountRole.INVENTORY_ADJUSTMENT`. Editing a product's on-hand quantity used to move a
   * real asset with no counterpart at all, so the balance sheet and the warehouse simply disagreed.
   */
  @Column({ name: 'default_inventory_adjustment_account_id', type: 'uuid', nullable: true })
  defaultInventoryAdjustmentAccountId: string | null = null;

  @Column({ name: 'default_forex_gain_loss_account_id', type: 'uuid', nullable: true })
  defaultForexGainLossAccountId: string | null = null;

  /**
   * Where bank charges land.
   *
   * Distinct from the exchange-difference account on purpose. A wire fee is a cost of banking; if
   * it is netted into the forex account an accountant reading that line sees currency movement
   * where there was a charge, and the two never reconcile against the bank statement separately.
   */
  @Column({ name: 'default_bank_fees_account_id', type: 'uuid', nullable: true })
  defaultBankFeesAccountId: string | null = null;

  @Column({ name: 'default_depreciation_expense_account_id', type: 'uuid', nullable: true })
  defaultDepreciationExpenseAccountId: string | null = null;

  @Column({ name: 'default_accumulated_depreciation_account_id', type: 'uuid', nullable: true })
  defaultAccumulatedDepreciationAccountId: string | null = null;

  @Column({ name: 'default_inflation_adjustment_account_id', type: 'uuid', nullable: true })
  defaultInflationAdjustmentAccountId: string | null = null;

  // ── Payroll ────────────────────────────────────────────────────────────────
  //
  // Derived from the chart's account roles at provisioning, like every default above. A payroll run
  // debits salary expense and the employer's own social cost, and credits a distinct liability for
  // each thing it owes to a different body — the net wage (to the employee), AFP and SFS (to the
  // TSS), INFOTEP/SRL, and the ISR withheld (to the DGII) — so each has its own account and none is
  // netted into another.

  @Column({ name: 'default_salary_expense_account_id', type: 'uuid', nullable: true })
  defaultSalaryExpenseAccountId: string | null = null;

  @Column({ name: 'default_employer_contributions_expense_account_id', type: 'uuid', nullable: true })
  defaultEmployerContributionsExpenseAccountId: string | null = null;

  @Column({ name: 'default_payroll_net_payable_account_id', type: 'uuid', nullable: true })
  defaultPayrollNetPayableAccountId: string | null = null;

  @Column({ name: 'default_afp_payable_account_id', type: 'uuid', nullable: true })
  defaultAfpPayableAccountId: string | null = null;

  @Column({ name: 'default_sfs_payable_account_id', type: 'uuid', nullable: true })
  defaultSfsPayableAccountId: string | null = null;

  @Column({ name: 'default_infotep_payable_account_id', type: 'uuid', nullable: true })
  defaultInfotepPayableAccountId: string | null = null;

  @Column({ name: 'default_payroll_tax_withholding_payable_account_id', type: 'uuid', nullable: true })
  defaultPayrollTaxWithholdingPayableAccountId: string | null = null;





  @Column({
    name: 'default_intercompany_receivable_id',
    type: 'uuid',
    nullable: true,
  })
  defaultIntercompanyReceivableAccountId: string | null = null;

  @Column({
    name: 'default_intercompany_payable_id',
    type: 'uuid',
    nullable: true,
  })
  defaultIntercompanyPayableAccountId: string | null = null;





  @Column({ name: 'fiscal_archive_after_years', type: 'int', default: 5 })
  fiscalArchiveAfterYears!: number;

  // ── Exchange-rate controls ────────────────────────────────────────────────
  //
  // A posting in foreign currency used to take whatever rate the request carried, checked only for
  // being positive. Anyone who could post an entry could therefore choose the rate it was booked
  // at, and an exchange gain or loss of any size could be manufactured by typing a different
  // number. These two settings are what let a tenant say how far a stated rate may sit from the
  // one on file, and how old a quote may be before it stops being usable.

  /**
   * How far a caller-supplied rate may deviate from the resolved one, as a fraction.
   *
   * A real bank fill differs from the published rate by a spread, so zero would be unusable in
   * practice; 2 % covers an ordinary spread and refuses a fabricated number. Set it to 0 to accept
   * only the rate on file.
   */
  @Column({
    name: 'fx_rate_tolerance',
    type: 'decimal',
    precision: 9,
    scale: 6,
    // Quoted: PostgreSQL stores a numeric default as the literal `0.02`, and an unquoted numeric
    // here makes TypeORM compare against `0.02` the number and see a difference that is not one.
    default: 0.02,
    transformer: numericTransformerNotNull,
  })
  fxRateTolerance!: number;

  /**
   * How stale a quote may be, in days, before a posting that would use it is refused.
   *
   * The lookup takes the newest quote at or before the posting date, which is right, and said
   * nothing about how old that was: a rate six months out of date converted as confidently as this
   * morning's. Ten days spans a long holiday weekend plus a missed refresh; beyond that the figure
   * is a guess.
   */
  @Column({ name: 'fx_rate_max_age_days', type: 'int', default: 10 })
  fxRateMaxAgeDays!: number;

  /**
   * Whether every member of this organization must hold a second factor.
   *
   * `user_security.is_two_factor_enabled` is a per-person choice, and until now it was the ONLY
   * lever: a tenant could not require MFA of its own staff. For a product that holds payroll,
   * treasury and the general ledger, "we would like everyone to turn it on" is not a control —
   * and it is the first thing any customer with a security questionnaire asks for.
   *
   * Enforcement is at sign-in: a member without a second factor is issued a session that carries
   * `mfaEnrolmentRequired`, and `MfaEnrolmentGuard` refuses every route except the ones needed to
   * enrol and to sign out. Refusing the login outright would be a lockout, since enrolling
   * requires being signed in.
   *
   * Off by default: turning this on for an existing tenant interrupts everyone's next sign-in, so
   * it is a decision its administrator makes deliberately.
   */
  @Column({ name: 'require_mfa', type: 'boolean', default: false })
  requireMfa!: boolean;
}
