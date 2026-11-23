import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { DepreciationConvention } from '@virtex/shared/types';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import type { FixedAsset } from './fixed-asset.entity';
import type { TaxDepreciationMethod } from './fixed-asset-category.entity';

/** The books an asset is depreciated in besides its accounting one. */
export enum FixedAssetBookKind {
  /**
   * What the tax authority lets the company deduct: its own categories, rates and methods, often
   * not the accounts'. Kept apart, posted nowhere — the books carry the accounting depreciation;
   * this one is what the tax return and the deferred tax read.
   */
  TAX = 'TAX',
}

/**
 * A book an asset is depreciated in besides its accounting one (audit 2026-11-07, FINB-16): its
 * tax book, which the register lacked — an asset could be depreciated one way only, the books'.
 *
 * Each book has its own basis, method, rate or life, convention and running total, and is charged
 * by the same runs and the same calculation as the accounting book (`depreciation-schedule.ts`),
 * month by month (`FixedAssetBookCharge`). It is a memorandum: it posts nothing. What it holds is
 * the deduction a tax return claims and, against the accounting book, the temporary difference.
 */
@Entity({ name: 'fixed_asset_books' })
@Index('UQ_fixed_asset_books_asset_kind', ['fixedAssetId', 'kind'], { unique: true })
@Check('CHK_fixed_asset_books_kind', `"kind" IN ('TAX')`)
@Check('CHK_fixed_asset_books_method', `"depreciation_method" IN ('STRAIGHT_LINE', 'DECLINING_BALANCE')`)
@Check('CHK_fixed_asset_books_rate', `"annual_rate" > 0 AND "annual_rate" <= 1`)
@Check('CHK_fixed_asset_books_convention', `"depreciation_convention" IN ('FULL_MONTH', 'NEXT_MONTH', 'MID_MONTH', 'DAILY')`)
@Check('CHK_fixed_asset_books_amounts', `"cost" >= 0 AND "residual_value" >= 0 AND "residual_value" <= "cost"`)
@Check('CHK_fixed_asset_books_opening', `("opening_accumulated_depreciation" > 0) = ("opening_through" IS NOT NULL)`)
@Check(
  'CHK_fixed_asset_books_accumulated',
  `"accumulated_depreciation" >= "opening_accumulated_depreciation" AND "opening_accumulated_depreciation" >= 0 AND "accumulated_depreciation" <= "cost" - "residual_value"`,
)
export class FixedAssetBook {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_fixed_asset_books_organization')
  organization?: TenantRef;

  @Column({ name: 'fixed_asset_id', type: 'uuid' })
  fixedAssetId: string;

  @ManyToOne('FixedAsset', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fixed_asset_id', foreignKeyConstraintName: 'FK_fixed_asset_books_asset' })
  fixedAsset?: FixedAsset;

  @Column({ type: 'varchar', length: 20 })
  kind: FixedAssetBookKind;

  /** The tax authority's category: `DO-2`. */
  @Column({ name: 'tax_category_code', type: 'varchar', length: 40, nullable: true })
  taxCategoryCode: string | null;

  /**
   * How the law depreciates it: `STRAIGHT_LINE` — the rate on the basis, every year until it is
   * deducted; `DECLINING_BALANCE` — the rate on what is left at the start of each fiscal year.
   */
  @Column({ name: 'depreciation_method', type: 'varchar', length: 32 })
  depreciationMethod: TaxDepreciationMethod;

  /**
   * The yearly rate the law states, as a fraction: 0.35 for 35 %. Kept as the rate, not as a life:
   * 35 % a year is 34.29 months, and a life of 34 would deduct 35.29 %.
   */
  @Column('decimal', { name: 'annual_rate', precision: 7, scale: 6, transformer: numericTransformerNotNull })
  annualRate: number;

  @Column({ name: 'depreciation_convention', type: 'varchar', length: 20 })
  depreciationConvention: DepreciationConvention;

  /** The basis the book depreciates: the asset's cost, unless the law allows less. */
  @Column('decimal', { precision: 18, scale: 2, transformer: numericTransformerNotNull })
  cost: number;

  @Column('decimal', { name: 'residual_value', precision: 18, scale: 2, default: 0, transformer: numericTransformerNotNull })
  residualValue: number;

  @Column('decimal', { name: 'accumulated_depreciation', precision: 18, scale: 2, default: 0, transformer: numericTransformerNotNull })
  accumulatedDepreciation: number;

  /** What was deducted before the asset entered this product — a migration's opening tax balance. */
  @Column('decimal', {
    name: 'opening_accumulated_depreciation',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  openingAccumulatedDepreciation: number;

  /** The last month the opening balance covers, as its last day; null without one. */
  @Column({ name: 'opening_through', type: 'date', nullable: true })
  openingThrough: string | null;

  /** The last month charged in this book, as its last day. */
  @Column({ name: 'depreciated_through', type: 'date', nullable: true })
  depreciatedThrough: string | null;

  /** The day the asset left the books: the book charges nothing after it. */
  @Column({ name: 'closed_on', type: 'date', nullable: true })
  closedOn: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
