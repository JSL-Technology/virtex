
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  Index,
  RelationId,
} from 'typeorm';
import { Organization } from './organization.entity';
import { ExchangeRateType } from '../../currencies/entities/exchange-rate.entity';
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
}
