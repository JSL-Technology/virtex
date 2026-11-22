import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import type { FixedAsset } from './fixed-asset.entity';

/** What set a depreciation run going. */
export enum DepreciationRunTrigger {
  /** The monthly job, for the month that just ended in the company's calendar. */
  SCHEDULE = 'SCHEDULE',
  /** The close of a period, which charges the month it closes before closing it. */
  PERIOD_CLOSE = 'PERIOD_CLOSE',
  /** A person, from the depreciation board. */
  MANUAL = 'MANUAL',
  /** The months one asset was still due when it was disposed of, charged before it left the books. */
  DISPOSAL = 'DISPOSAL',
}

/**
 * One depreciation run that charged something: when, why, by whom, through which month, and what.
 *
 * The run left no record of its own. Its entries said only «monthly-depreciation» — the schedule,
 * a period close and a person running it by hand all wrote the same reason — so «who charged
 * March, and when?» had no answer, and an entry led nowhere but to itself (FINB-17). Every run
 * that charges a month is a document now: its entries carry its id in their idempotency key
 * (`depreciation-run:<id>:<date>`), each asset-month it charged points back to it, and the board
 * lists them.
 *
 * A run that finds nothing due leaves no row: there is nothing it did to account for.
 */
@Entity({ name: 'fixed_asset_depreciation_runs' })
@Index('IDX_fixed_asset_depreciation_runs_org_created', ['organizationId', 'createdAt'])
@Check(
  'CHK_fixed_asset_depreciation_runs_trigger',
  `"trigger" IN ('SCHEDULE', 'PERIOD_CLOSE', 'MANUAL', 'DISPOSAL')`,
)
// A disposal's run is about the one asset disposed of, and only a disposal's run is.
@Check(
  'CHK_fixed_asset_depreciation_runs_disposal_asset',
  `("trigger" = 'DISPOSAL') = ("fixed_asset_id" IS NOT NULL)`,
)
@Check('CHK_fixed_asset_depreciation_runs_totals', `"asset_count" > 0 AND "charge_count" >= "asset_count" AND "total" > 0`)
export class FixedAssetDepreciationRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_fixed_asset_depreciation_runs_organization')
  organization?: TenantRef;

  /** The last day of the month the run charged through. */
  @Column({ name: 'period_end', type: 'date' })
  periodEnd: string;

  @Column({ type: 'varchar', length: 20 })
  trigger: DepreciationRunTrigger;

  /** The asset whose disposal ran it; null for every other run. */
  @Column({ name: 'fixed_asset_id', type: 'uuid', nullable: true })
  fixedAssetId: string | null;

  @ManyToOne('FixedAsset', { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'fixed_asset_id', foreignKeyConstraintName: 'FK_fixed_asset_depreciation_runs_asset' })
  fixedAsset?: FixedAsset;

  /** Who ran it: the person at the board, or who disposed of the asset; null for the schedule. */
  @Column({ name: 'ran_by_user_id', type: 'uuid', nullable: true })
  ranByUserId: string | null;

  /** How many assets it charged, and how many asset-months. */
  @Column({ name: 'asset_count', type: 'int' })
  assetCount: number;

  @Column({ name: 'charge_count', type: 'int' })
  chargeCount: number;

  @Column('decimal', { precision: 18, scale: 2, transformer: numericTransformerNotNull })
  total: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
