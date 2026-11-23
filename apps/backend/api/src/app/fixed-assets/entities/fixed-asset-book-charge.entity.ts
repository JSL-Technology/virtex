import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import type { FixedAssetBook } from './fixed-asset-book.entity';
import type { FixedAssetDepreciationRun } from './fixed-asset-depreciation-run.entity';

/**
 * One month charged in one of an asset's other books — its tax book — by the run that charged it.
 * Unique per book and month, as the accounting book's months are: a month is charged once, whichever
 * run reaches it.
 */
@Entity({ name: 'fixed_asset_book_charges' })
@Index('UQ_fixed_asset_book_charges_book_period', ['bookId', 'periodEnd'], { unique: true })
@Index('IDX_fixed_asset_book_charges_org_period', ['organizationId', 'periodEnd'])
@Index('IDX_fixed_asset_book_charges_run', ['runId'])
@Check('CHK_fixed_asset_book_charges_amount', `"amount" > 0`)
export class FixedAssetBookCharge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_fixed_asset_book_charges_organization')
  organization?: TenantRef;

  @Column({ name: 'book_id', type: 'uuid' })
  bookId: string;

  // A month charged is history: its book cannot be deleted from under it.
  @ManyToOne('FixedAssetBook', { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'book_id', foreignKeyConstraintName: 'FK_fixed_asset_book_charges_book' })
  book?: FixedAssetBook;

  /** The last day of the month charged. */
  @Column({ name: 'period_end', type: 'date' })
  periodEnd: string;

  @Column('decimal', { precision: 18, scale: 2, transformer: numericTransformerNotNull })
  amount: number;

  @Column('decimal', { name: 'accumulated_after', precision: 18, scale: 2, transformer: numericTransformerNotNull })
  accumulatedAfter: number;

  @Column('decimal', { name: 'book_value_after', precision: 18, scale: 2, transformer: numericTransformerNotNull })
  bookValueAfter: number;

  /** The run that charged it. */
  @Column({ name: 'run_id', type: 'uuid', nullable: true })
  runId: string | null;

  @ManyToOne('FixedAssetDepreciationRun', { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'run_id', foreignKeyConstraintName: 'FK_fixed_asset_book_charges_run' })
  run?: FixedAssetDepreciationRun | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
