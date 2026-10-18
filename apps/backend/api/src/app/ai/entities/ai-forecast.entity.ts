import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import type { AiModelRun } from './ai-model-run.entity';

/**
 * Expected units sold of one product, in one warehouse, on one day — as a range, not a number.
 *
 * P50 is the median: as likely to be beaten as missed. P10 and P90 bound the plausible range, and
 * they are what stock decisions are made from — safety stock is sized on the P90, not on the
 * median, because running out is costlier than holding one more unit.
 *
 * Written only by the engine, and replaced wholesale by each run.
 */
@Entity({ name: 'ai_forecasts' })
@Index('IDX_ai_forecasts_org_product_warehouse_date', [
  'organizationId',
  'productId',
  'warehouseId',
  'forecastDate',
])
@Index('IDX_ai_forecasts_run', ['runId'])
export class AiForecast {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ai_forecasts_organization')
  organization?: TenantRef;

  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @ManyToOne('AiModelRun', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id', foreignKeyConstraintName: 'FK_ai_forecasts_run' })
  run?: AiModelRun;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne('Product', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'FK_ai_forecasts_product' })
  product?: unknown;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @Column({ name: 'forecast_date', type: 'date' })
  forecastDate: string;

  @Column({ type: 'decimal', precision: 18, scale: 6, default: 0, transformer: numericTransformerNotNull })
  p10: number;

  @Column({ type: 'decimal', precision: 18, scale: 6, default: 0, transformer: numericTransformerNotNull })
  p50: number;

  @Column({ type: 'decimal', precision: 18, scale: 6, default: 0, transformer: numericTransformerNotNull })
  p90: number;

  /** The model that won the backtest for this series. */
  @Column({ type: 'varchar', length: 48 })
  model: string;
}
