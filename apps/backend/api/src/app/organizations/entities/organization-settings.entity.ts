
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
}
