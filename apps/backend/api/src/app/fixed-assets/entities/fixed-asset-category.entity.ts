import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { DepreciationConvention, LocalizedName } from '@virtex/shared/types';
import { numericTransformer, numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { NameTranslationsCheck, NameTranslationsColumn } from '../../common/database/name-translations.column';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { DepreciationMethod } from './fixed-asset.entity';

/** A reference to an account, without importing the ledger's entities. */
interface Ref {
  readonly id: string;
}

/** The methods a tax book can follow: what tax laws state. */
export type TaxDepreciationMethod = DepreciationMethod.STRAIGHT_LINE | DepreciationMethod.DECLINING_BALANCE;

/**
 * A class of fixed assets — vehicles, computers, buildings — and what an asset of it starts with
 * (audit 2026-11-07, FINB-16).
 *
 * The register had no classes: every asset was typed in from nothing, its life, method and four
 * accounts each time, and nothing said which of the tax authority's categories it fell in. A
 * category carries the defaults an asset of it is registered with — copied onto the asset, so a
 * later change to the category rewrites no asset's history — and the tax category and rate its
 * tax book starts from (`FixedAssetBook`).
 */
@Entity({ name: 'fixed_asset_categories' })
@NameTranslationsCheck('fixed_asset_categories')
@Index('UQ_fixed_asset_categories_org_code', ['organizationId', 'code'], { unique: true })
@Check('CHK_fixed_asset_categories_life', `"useful_life_months" IS NULL OR "useful_life_months" > 0`)
@Check(
  'CHK_fixed_asset_categories_method',
  `"depreciation_method" IS NULL OR "depreciation_method" IN ('STRAIGHT_LINE', 'DOUBLE_DECLINING_BALANCE', 'SUM_OF_YEARS_DIGITS', 'DECLINING_BALANCE')`,
)
@Check(
  'CHK_fixed_asset_categories_declining_rate',
  `(COALESCE("depreciation_method", '') = 'DECLINING_BALANCE') = ("declining_annual_rate" IS NOT NULL) AND ("declining_annual_rate" IS NULL OR ("declining_annual_rate" > 0 AND "declining_annual_rate" <= 1))`,
)
@Check(
  'CHK_fixed_asset_categories_convention',
  `"depreciation_convention" IS NULL OR "depreciation_convention" IN ('FULL_MONTH', 'NEXT_MONTH', 'MID_MONTH', 'DAILY')`,
)
@Check('CHK_fixed_asset_categories_residual', `"residual_rate" >= 0 AND "residual_rate" < 1`)
@Check(
  'CHK_fixed_asset_categories_tax',
  `("tax_method" IS NULL) = ("tax_annual_rate" IS NULL) AND ("tax_method" IS NULL OR "tax_method" IN ('STRAIGHT_LINE', 'DECLINING_BALANCE')) AND ("tax_annual_rate" IS NULL OR ("tax_annual_rate" > 0 AND "tax_annual_rate" <= 1))`,
)
export class FixedAssetCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_fixed_asset_categories_organization')
  organization?: TenantRef;

  /** `VEH`, `EQ-COMP`: what a person finds it by. Unique in the company. */
  @Column({ type: 'varchar', length: 40 })
  code: string;

  /** As the books name it, in the books language. */
  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** The name in the other languages: see `NameTranslationsColumn`. */
  @NameTranslationsColumn()
  nameTranslations: LocalizedName;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // ── What an asset of the category starts with ────────────────────────────────────────────────

  @Column({ name: 'useful_life_months', type: 'int', nullable: true })
  usefulLifeMonths: number | null;

  @Column({ name: 'depreciation_method', type: 'varchar', length: 32, nullable: true })
  depreciationMethod: DepreciationMethod | null;

  /** The yearly rate of a `DECLINING_BALANCE` method, as a fraction. */
  @Column('decimal', { name: 'declining_annual_rate', precision: 7, scale: 6, nullable: true, transformer: numericTransformer })
  decliningAnnualRate: number | null;

  @Column({ name: 'depreciation_convention', type: 'varchar', length: 20, nullable: true })
  depreciationConvention: DepreciationConvention | null;

  /** The share of the cost an asset of it is expected to be worth at the end: 0.1 for 10 %. */
  @Column('decimal', { name: 'residual_rate', precision: 7, scale: 6, default: 0, transformer: numericTransformerNotNull })
  residualRate: number;

  @Column({ name: 'asset_account_id', type: 'uuid', nullable: true })
  assetAccountId: string | null;

  @ManyToOne('Account', { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'asset_account_id', foreignKeyConstraintName: 'FK_fixed_asset_categories_asset_account' })
  assetAccount?: Ref | null;

  @Column({ name: 'accumulated_depreciation_account_id', type: 'uuid', nullable: true })
  accumulatedDepreciationAccountId: string | null;

  @ManyToOne('Account', { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'accumulated_depreciation_account_id', foreignKeyConstraintName: 'FK_fixed_asset_categories_accumulated_account' })
  accumulatedDepreciationAccount?: Ref | null;

  @Column({ name: 'depreciation_expense_account_id', type: 'uuid', nullable: true })
  depreciationExpenseAccountId: string | null;

  @ManyToOne('Account', { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'depreciation_expense_account_id', foreignKeyConstraintName: 'FK_fixed_asset_categories_expense_account' })
  depreciationExpenseAccount?: Ref | null;

  /** Where a disposal books a gain, and a loss: the defaults the disposal screen offers. */
  @Column({ name: 'gain_on_disposal_account_id', type: 'uuid', nullable: true })
  gainOnDisposalAccountId: string | null;

  @ManyToOne('Account', { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'gain_on_disposal_account_id', foreignKeyConstraintName: 'FK_fixed_asset_categories_gain_account' })
  gainOnDisposalAccount?: Ref | null;

  @Column({ name: 'loss_on_disposal_account_id', type: 'uuid', nullable: true })
  lossOnDisposalAccountId: string | null;

  @ManyToOne('Account', { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'loss_on_disposal_account_id', foreignKeyConstraintName: 'FK_fixed_asset_categories_loss_account' })
  lossOnDisposalAccount?: Ref | null;

  // ── The tax book an asset of it starts with ──────────────────────────────────────────────────

  /** The tax authority's category, as the market names it: `DO-2`. Null where none applies. */
  @Column({ name: 'tax_category_code', type: 'varchar', length: 40, nullable: true })
  taxCategoryCode: string | null;

  /** How the tax book depreciates; null for a category whose assets keep no tax book. */
  @Column({ name: 'tax_method', type: 'varchar', length: 32, nullable: true })
  taxMethod: TaxDepreciationMethod | null;

  /** The tax book's yearly rate, as a fraction: 0.25 for 25 %. */
  @Column('decimal', { name: 'tax_annual_rate', precision: 7, scale: 6, nullable: true, transformer: numericTransformer })
  taxAnnualRate: number | null;

  /** A category no longer offered for new assets; the assets of it keep it. */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
