import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import type { FixedAsset } from './fixed-asset.entity';

/**
 * One month of depreciation charged to one asset, and the entry that charged it.
 *
 * The register kept only the running total, so nobody could say what a given month had charged
 * an asset, nor rebuild the schedule from the entries. One row per asset and month — unique, so a
 * month cannot be charged twice whichever run reaches it — gives the depreciation board its past,
 * and the schedule projects its future from the last of them.
 */
@Entity({ name: 'fixed_asset_depreciations' })
@Index('UQ_fixed_asset_depreciations_asset_period', ['fixedAssetId', 'periodEnd'], { unique: true })
@Index('IDX_fixed_asset_depreciations_org_period', ['organizationId', 'periodEnd'])
@Check('CHK_fixed_asset_depreciations_amount', `"amount" > 0`)
export class FixedAssetDepreciation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_fixed_asset_depreciations_organization')
  organization?: TenantRef;

  @Column({ name: 'fixed_asset_id', type: 'uuid' })
  fixedAssetId: string;

  @ManyToOne('FixedAsset', { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'fixed_asset_id', foreignKeyConstraintName: 'FK_fixed_asset_depreciations_asset' })
  fixedAsset?: FixedAsset;

  /** The last day of the month charged. */
  @Column({ name: 'period_end', type: 'date' })
  periodEnd: string;

  @Column('decimal', { precision: 18, scale: 2, transformer: numericTransformerNotNull })
  amount: number;

  @Column('decimal', { name: 'accumulated_after', precision: 18, scale: 2, transformer: numericTransformerNotNull })
  accumulatedAfter: number;

  @Column('decimal', { name: 'book_value_after', precision: 18, scale: 2, transformer: numericTransformerNotNull })
  bookValueAfter: number;

  @Column({ name: 'journal_entry_id', type: 'uuid' })
  journalEntryId: string;

  @ManyToOne('JournalEntry', { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'journal_entry_id', foreignKeyConstraintName: 'FK_fixed_asset_depreciations_entry' })
  journalEntry?: { readonly id: string };

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
