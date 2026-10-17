import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import {
  numericTransformer,
  numericTransformerNotNull,
} from '../../common/database/numeric.transformer';
import type { AiModelRun } from './ai-model-run.entity';

/**
 * Where a series stands, and what to do about it.
 *
 *   - `STOCKOUT_RISK`: projected to run out before a reorder placed today would arrive.
 *   - `REORDER`: at or below its reorder point, with time to act.
 *   - `OVERSTOCK`: holding more than the cover target at the P90 of demand.
 *   - `DEAD_STOCK`: stock on hand and no demand in the history or the forecast.
 *   - `OK`: none of the above.
 */
export type AiInventoryStatus = 'STOCKOUT_RISK' | 'REORDER' | 'OVERSTOCK' | 'DEAD_STOCK' | 'OK';

/**
 * The decision-ready summary of one product in one warehouse, from the latest forecast run.
 *
 * Every number here is computed by the engine from the forecast, the stock ledger and the measured
 * supplier lead time — none is produced by a language model. One row per series, replaced by each
 * run, so reading the current state never needs to know which run is current.
 */
@Entity({ name: 'ai_inventory_insights' })
@Index('UQ_ai_inventory_insights_org_product_warehouse', ['organizationId', 'productId', 'warehouseId'], {
  unique: true,
})
@Index('IDX_ai_inventory_insights_org_status', ['organizationId', 'status'])
export class AiInventoryInsight {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ai_inventory_insights_organization')
  organization?: TenantRef;

  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @ManyToOne('AiModelRun', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id', foreignKeyConstraintName: 'FK_ai_inventory_insights_run' })
  run?: AiModelRun;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne('Product', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'FK_ai_inventory_insights_product' })
  product?: unknown;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @Column({ name: 'on_hand', type: 'decimal', precision: 18, scale: 6, default: 0, transformer: numericTransformerNotNull })
  onHand: number;

  @Column({ name: 'avg_daily_demand', type: 'decimal', precision: 18, scale: 6, default: 0, transformer: numericTransformerNotNull })
  avgDailyDemand: number;

  /** Median units expected over the next 30 days. */
  @Column({ name: 'forecast_30d', type: 'decimal', precision: 18, scale: 6, default: 0, transformer: numericTransformerNotNull })
  forecast30d: number;

  @Column({ name: 'forecast_30d_p90', type: 'decimal', precision: 18, scale: 6, default: 0, transformer: numericTransformerNotNull })
  forecast30dP90: number;

  /** Days the stock on hand lasts at the median forecast. Null when nothing is expected to sell. */
  @Column({ name: 'days_of_cover', type: 'decimal', precision: 18, scale: 6, nullable: true, transformer: numericTransformer })
  daysOfCover: number | null;

  @Column({ name: 'stockout_date', type: 'date', nullable: true })
  stockoutDate: string | null;

  /** Measured from this product's receipts, or the tenant's typical one when it has none. */
  @Column({ name: 'lead_time_days', type: 'decimal', precision: 18, scale: 6, nullable: true, transformer: numericTransformer })
  leadTimeDays: number | null;

  @Column({ name: 'safety_stock', type: 'decimal', precision: 18, scale: 6, default: 0, transformer: numericTransformerNotNull })
  safetyStock: number;

  @Column({ name: 'reorder_point', type: 'decimal', precision: 18, scale: 6, default: 0, transformer: numericTransformerNotNull })
  reorderPoint: number;

  @Column({ name: 'suggested_order_qty', type: 'decimal', precision: 18, scale: 6, default: 0, transformer: numericTransformerNotNull })
  suggestedOrderQty: number;

  /** The probability of not running out during a lead time that the safety stock is sized for. */
  @Column({ name: 'service_level', type: 'decimal', precision: 9, scale: 6, transformer: numericTransformerNotNull })
  serviceLevel: number;

  @Column({ type: 'varchar', length: 16 })
  status: AiInventoryStatus;

  /** Position by projected units sold within its branch: 1 is the branch's best seller. */
  @Column({ name: 'branch_rank', type: 'integer', nullable: true })
  branchRank: number | null;

  @Column({ type: 'varchar', length: 48 })
  model: string;

  /** Weighted absolute percentage error of the chosen model on held-out history; lower is better. */
  @Column({ name: 'accuracy_wape', type: 'decimal', precision: 18, scale: 6, nullable: true, transformer: numericTransformer })
  accuracyWape: number | null;

  /** Days of history excluded from training because the shelf was empty: sales were censored. */
  @Column({ name: 'censored_days', type: 'integer', default: 0 })
  censoredDays: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
