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
import type { DepreciationConvention } from '@virtex/shared/types';
import { numericTransformer, numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { BranchRef, IssuedAtBranch } from '../../organizations/contracts/branch.contract';

/**
 * How an asset's cost entered the ledger (audit 2026-11-07, FINB-15). Registering it posted
 * nothing and said nothing of it: the register and the asset account could disagree with no one
 * the wiser.
 */
export enum FixedAssetCapitalization {
  /** A posted supplier bill debited its asset account. */
  VENDOR_BILL = 'VENDOR_BILL',
  /** An entry already in the books did: an opening balance, a cash purchase. */
  JOURNAL_ENTRY = 'JOURNAL_ENTRY',
  /** The register posted the acquisition itself, against the account it names. */
  POSTED = 'POSTED',
  /** Registered before the rule: listed by the reconciliation until it is linked. */
  UNLINKED = 'UNLINKED',
}

export enum FixedAssetStatus {
  IN_USE = 'IN_USE',
  /** Retired without a sale: scrapped, lost, donated. */
  DISPOSED = 'DISPOSED',
  SOLD = 'SOLD',
}

/** How the depreciable base is spread over the useful life. */
export enum DepreciationMethod {
  STRAIGHT_LINE = 'STRAIGHT_LINE',
  DOUBLE_DECLINING_BALANCE = 'DOUBLE_DECLINING_BALANCE',
  SUM_OF_YEARS_DIGITS = 'SUM_OF_YEARS_DIGITS',
  /**
   * A fixed annual rate on the value not yet depreciated, with no switch to straight line — the way
   * a tax authority states a declining balance: 25 % a year on what is left (DGII, Ley 11-92 art.
   * 287, categories 2 and 3). The rate is the book's (`decliningAnnualRate`); the life is only the
   * horizon at which what is left is written off.
   */
  DECLINING_BALANCE = 'DECLINING_BALANCE',
}

/** A reference to an account or an entry, without importing the ledger's entities. */
interface Ref {
  readonly id: string;
}

/**
 * One item of the fixed-asset register.
 *
 * ## What it was
 *
 * A name, a cost in `numeric(10,2)` (a building above 99 999 999 did not fit), a purchase
 * **timestamp**, and two account ids in `varchar` columns with no foreign key — so a typo'd id
 * stayed in the register until the depreciation run posted to an account that did not exist. It
 * had no number to find it by, no branch, no depreciation expense account of its own (every asset
 * of the tenant was charged to the same one, whatever the asset was), and a disposal left no trace
 * of when, for how much, or with which entry.
 *
 * ## What registering one does
 *
 * Nothing in the ledger. An asset reaches the books through the bill that bought it (debiting the
 * asset account) or through the opening balances of a migration; the register records what that
 * cost is, how it wears out and what has been charged. An asset migrated in mid-life carries the
 * depreciation charged before (`openingAccumulatedDepreciation`) and the month through which it
 * was charged, so the first run picks up from there instead of charging its whole past again.
 */
@Entity({ name: 'fixed_asset' })
@Index('UQ_fixed_asset_org_number', ['organizationId', 'number'], { unique: true })
@Index('IDX_fixed_asset_org_status', ['organizationId', 'status'])
@Index('IDX_fixed_asset_category', ['categoryId'])
@Index('IDX_fixed_asset_capitalization_entry', ['capitalizationEntryId'])
@Index('IDX_fixed_asset_vendor_bill', ['vendorBillId'])
@Check(
  'CHK_fixed_asset_capitalization',
  `"capitalization_method" IN ('VENDOR_BILL', 'JOURNAL_ENTRY', 'POSTED', 'UNLINKED') AND ("capitalization_method" <> 'VENDOR_BILL' OR "vendor_bill_id" IS NOT NULL) AND (("capitalization_method" IN ('JOURNAL_ENTRY', 'POSTED')) = ("capitalization_entry_id" IS NOT NULL)) AND (("capitalization_method" = 'POSTED') = ("capitalization_offset_account_id" IS NOT NULL))`,
)
@Check('CHK_fixed_asset_cost', `"cost" >= 0`)
@Check('CHK_fixed_asset_residual', `"residual_value" >= 0 AND "residual_value" <= "cost"`)
@Check('CHK_fixed_asset_useful_life', `"useful_life_months" > 0`)
@Check(
  'CHK_fixed_asset_accumulated',
  `"accumulated_depreciation" >= 0 AND "accumulated_depreciation" <= "cost" - "residual_value"`,
)
@Check(
  'CHK_fixed_asset_method',
  `"depreciation_method" IN ('STRAIGHT_LINE', 'DOUBLE_DECLINING_BALANCE', 'SUM_OF_YEARS_DIGITS', 'DECLINING_BALANCE')`,
)
@Check(
  'CHK_fixed_asset_declining_rate',
  `("depreciation_method" = 'DECLINING_BALANCE') = ("declining_annual_rate" IS NOT NULL) AND ("declining_annual_rate" IS NULL OR ("declining_annual_rate" > 0 AND "declining_annual_rate" <= 1))`,
)
@Check(
  'CHK_fixed_asset_convention',
  `"depreciation_convention" IN ('FULL_MONTH', 'NEXT_MONTH', 'MID_MONTH', 'DAILY')`,
)
export class FixedAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_fixed_asset_organization')
  organization?: TenantRef;

  /** `AF-2026-000042`. */
  @Column({ type: 'varchar', length: 40 })
  number: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /**
   * Its class (FINB-16): vehicles, computers, buildings. What it was registered with came from
   * there and is the asset's own — a change to the category rewrites no asset.
   */
  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  @ManyToOne('FixedAssetCategory', { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'category_id', foreignKeyConstraintName: 'FK_fixed_asset_category' })
  category?: Ref | null;

  /** Where the asset is held and used — see `IssuedAtBranch`. */
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @IssuedAtBranch('FK_fixed_asset_branch')
  branch?: BranchRef | null;

  /** The day it was bought — a calendar date. */
  @Column({ name: 'acquisition_date', type: 'date' })
  acquisitionDate: string;

  /**
   * The day it started to be used, from whose month the depreciation runs. Usually the day it was
   * bought; later for a machine that waited months to be installed.
   */
  @Column({ name: 'in_service_date', type: 'date' })
  inServiceDate: string;

  @Column('decimal', { precision: 18, scale: 2, transformer: numericTransformerNotNull })
  cost: number;

  /** What it is expected to be worth at the end of its life: never depreciated. */
  @Column('decimal', { name: 'residual_value', precision: 18, scale: 2, default: 0, transformer: numericTransformerNotNull })
  residualValue: number;

  @Column({ name: 'useful_life_months', type: 'int' })
  usefulLifeMonths: number;

  @Column({ name: 'depreciation_method', type: 'varchar', length: 32, default: DepreciationMethod.STRAIGHT_LINE })
  depreciationMethod: DepreciationMethod;

  /** The yearly rate of a `DECLINING_BALANCE` method, as a fraction: 0.25 for 25 %. Null for any other. */
  @Column('decimal', { name: 'declining_annual_rate', precision: 7, scale: 6, nullable: true, transformer: numericTransformer })
  decliningAnnualRate: number | null;

  /**
   * How much of the month it entered service in, and of the month it leaves, is charged
   * (`DEPRECIATION_CONVENTIONS`; FINB-12). Defaulted from the company's when it is registered, and
   * fixed once a month has been charged: it decided how much that first month took.
   */
  @Column({ name: 'depreciation_convention', type: 'varchar', length: 20, default: 'FULL_MONTH' })
  depreciationConvention: DepreciationConvention;

  /** Cost less accumulated depreciation, kept in step by every run. */
  @Column('decimal', { name: 'book_value', precision: 18, scale: 2, nullable: true, transformer: numericTransformer })
  bookValue: number;

  @Column('decimal', {
    name: 'accumulated_depreciation',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  accumulatedDepreciation: number;

  /**
   * Depreciation charged before the asset entered this product — a migration's opening balance.
   * Part of `accumulatedDepreciation`, recorded apart because no entry here posted it.
   */
  @Column('decimal', {
    name: 'opening_accumulated_depreciation',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  openingAccumulatedDepreciation: number;

  /**
   * The last month this asset has been depreciated through, as its last day.
   *
   * Nothing recorded this once, so the depreciation run had no way to tell what it had already
   * posted. The cron fired nightly and charged a full month each time; a five-year asset was
   * written down in about two months, and the period close ran it once more on top.
   */
  @Column({ name: 'depreciated_through', type: 'date', nullable: true })
  depreciatedThrough: string | null;

  @Column({ type: 'enum', enum: FixedAssetStatus, default: FixedAssetStatus.IN_USE })
  status: FixedAssetStatus;

  /** Where the cost sits: debited by the bill that bought it, credited by the disposal. */
  @Column({ name: 'asset_account_id', type: 'uuid', nullable: true })
  assetAccountId: string | null;

  @ManyToOne('Account', { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'asset_account_id', foreignKeyConstraintName: 'FK_fixed_asset_asset_account' })
  assetAccount?: Ref | null;

  /** The contra account each month's charge is credited to. */
  @Column({ name: 'accumulated_depreciation_account_id', type: 'uuid', nullable: true })
  accumulatedDepreciationAccountId: string | null;

  @ManyToOne('Account', { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'accumulated_depreciation_account_id',
    foreignKeyConstraintName: 'FK_fixed_asset_accumulated_account',
  })
  accumulatedDepreciationAccount?: Ref | null;

  /**
   * The expense each month's charge is debited to. Null falls back to the company's default —
   * a delivery van and an office building are usually charged to different lines of the income
   * statement, which a single company-wide account could not say.
   */
  @Column({ name: 'depreciation_expense_account_id', type: 'uuid', nullable: true })
  depreciationExpenseAccountId: string | null;

  @ManyToOne('Account', { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'depreciation_expense_account_id',
    foreignKeyConstraintName: 'FK_fixed_asset_expense_account',
  })
  depreciationExpenseAccount?: Ref | null;

  /** The supplier bill that bought it, when it was capitalised from one. */
  @Column({ name: 'vendor_bill_id', type: 'uuid', nullable: true })
  vendorBillId: string | null;

  // A bill an asset was capitalized from is not deleted from under it.
  @ManyToOne('VendorBill', { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'vendor_bill_id', foreignKeyConstraintName: 'FK_fixed_asset_vendor_bill' })
  vendorBill?: Ref | null;

  /** How its cost entered the ledger (FINB-15): see `FixedAssetCapitalization`. */
  @Column({ name: 'capitalization_method', type: 'varchar', length: 20, default: FixedAssetCapitalization.UNLINKED })
  capitalizationMethod: FixedAssetCapitalization;

  /** The entry that carried its cost into the books: one already there, or the one posted here. */
  @Column({ name: 'capitalization_entry_id', type: 'uuid', nullable: true })
  capitalizationEntryId: string | null;

  @ManyToOne('JournalEntry', { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'capitalization_entry_id', foreignKeyConstraintName: 'FK_fixed_asset_capitalization_entry' })
  capitalizationEntry?: Ref | null;

  /** What the acquisition posted here was credited to: the bank, a payable, opening equity. */
  @Column({ name: 'capitalization_offset_account_id', type: 'uuid', nullable: true })
  capitalizationOffsetAccountId: string | null;

  @ManyToOne('Account', { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'capitalization_offset_account_id', foreignKeyConstraintName: 'FK_fixed_asset_capitalization_offset_account' })
  capitalizationOffsetAccount?: Ref | null;

  @Column({ name: 'disposal_date', type: 'date', nullable: true })
  disposalDate: string | null;

  @Column('decimal', { name: 'disposal_proceeds', precision: 18, scale: 2, nullable: true, transformer: numericTransformer })
  disposalProceeds: number | null;

  @Column({ name: 'disposal_reason', type: 'text', nullable: true })
  disposalReason: string | null;

  /** The entry that took the asset off the books. */
  @Column({ name: 'disposal_journal_entry_id', type: 'uuid', nullable: true })
  disposalJournalEntryId: string | null;

  @ManyToOne('JournalEntry', { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'disposal_journal_entry_id', foreignKeyConstraintName: 'FK_fixed_asset_disposal_entry' })
  disposalJournalEntry?: Ref | null;

  @Column({ name: 'disposed_by_user_id', type: 'uuid', nullable: true })
  disposedByUserId: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
