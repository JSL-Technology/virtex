
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
