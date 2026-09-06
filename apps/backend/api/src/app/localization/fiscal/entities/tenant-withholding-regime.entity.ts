import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Organization } from '../../../organizations/entities/organization.entity';
import { numericTransformerNotNull } from '../../../common/database/numeric.transformer';
import { TaxpayerType, WithholdingKind, WithholdingScope } from '../withholding-regimes';

/**
 * A withholding regime the tenant configured for itself.
 *
 * Two things make this necessary rather than a nicety.
 *
 * Most of this product's markets are marked `configurationRequired` in the built-in catalogue,
 * because their rate turns on a municipality, an activity code, or a designation the authority
 * publishes per taxpayer. Those tenants have real withholding obligations and no built-in regime
 * to meet them with; without this table their only option is to state a rate per document, which
 * is the very thing the audit found.
 *
 * And rates change by decree, between releases. A tenant whose authority moves a rate in March
 * cannot wait for a deployment to file correctly in April.
 *
 * A row here for the same `(kind, payer, payee, scope)` as a built-in regime replaces it — the
 * tenant's accountant is the authority on the tenant's own filings.
 */
// A rate outside [0, 1] is not a withholding rate, and a regime with no payer applies to nobody.
// Both are configuration mistakes that would otherwise surface as a wrong filing.
@Check(
  'CHK_tenant_withholding_regimes_rate',
  '"rate" >= 0 AND "rate" <= 1 AND array_length("payers", 1) >= 1',
)
@Entity({ name: 'tenant_withholding_regimes' })
@Index('IDX_tenant_withholding_regimes_org', ['organizationId', 'isActive'])
@Index('UQ_tenant_withholding_regimes_code', ['organizationId', 'code'], { unique: true })
export class TenantWithholdingRegime {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'organization_id',
    foreignKeyConstraintName: 'FK_tenant_withholding_regimes_organization',
  })
  organization: Organization;

  /** Stable identifier recorded on every document the regime is applied to. */
  @Column({ length: 40 })
  code: string;

  @Column({ length: 160 })
  label: string;

  /** `VAT` withholds a share of the output tax; `INCOME` a share of the taxable base. */
  @Column({ name: 'kind', type: 'varchar', length: 8 })
  kind: WithholdingKind;

  /** As a fraction: `0.30` is 30 %. Six decimals, because some regimes are stated per mille. */
  @Column('decimal', {
    precision: 9,
    scale: 6,
    transformer: numericTransformerNotNull,
  })
  rate: number;

  /** Buyer classifications this regime applies to. Empty is meaningless and is rejected. */
  @Column({ name: 'payers', type: 'text', array: true })
  payers: TaxpayerType[];

  /** Seller classifications. Empty means it does not depend on the seller. */
  @Column({ name: 'payees', type: 'text', array: true, default: '{}' })
  payees: TaxpayerType[];

  @Column({ name: 'scope', type: 'varchar', length: 10, default: 'ANY' })
  scope: WithholdingScope;

  /**
   * The instrument that establishes it, in the tenant's own words.
   *
   * Required. A regime with no stated basis is a number somebody typed, and the point of moving
   * withholding off the request was to stop the rate being a number somebody typed.
   */
  @Column({ name: 'legal_basis', type: 'text' })
  legalBasis: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
