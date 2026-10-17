import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import type { AiModelRun } from './ai-model-run.entity';

/**
 * One day of a projected cash balance, as a band: P50 is the median path, P10 and P90 bound the
 * plausible ones. Written by the engine for a CASHFLOW (the projection) or SCENARIO (a what-if) run.
 */
@Entity({ name: 'ai_cashflow_forecasts' })
@Unique('UQ_ai_cashflow_forecasts_run_day', ['runId', 'day'])
@Index('IDX_ai_cashflow_forecasts_org_run', ['organizationId', 'runId'])
export class AiCashflowForecast {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ai_cashflow_forecasts_organization')
  organization?: TenantRef;

  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @ManyToOne('AiModelRun', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id', foreignKeyConstraintName: 'FK_ai_cashflow_forecasts_run' })
  run?: AiModelRun;

  @Column({ type: 'date' })
  day: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, transformer: numericTransformerNotNull })
  p10: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, transformer: numericTransformerNotNull })
  p50: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, transformer: numericTransformerNotNull })
  p90: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0, transformer: numericTransformerNotNull })
  inflow: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0, transformer: numericTransformerNotNull })
  outflow: number;

  /** Mean amount per component that day: receivables, payables, new_sales, new_spending, payroll, scenario. */
  @Column({ type: 'jsonb', default: {} })
  components: Record<string, number>;
}
