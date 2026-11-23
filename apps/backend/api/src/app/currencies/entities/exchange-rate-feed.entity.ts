import { Check, Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Where a feed stands: watching (it reads and compares, writes nothing), active (its figures are the
 * official rates), or switched off.
 */
export enum ExchangeRateFeedStatus {
  SHADOW = 'SHADOW',
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

/**
 * The state of one official-rate feed in this deployment (FINB-03).
 *
 * The feed itself — what it reads and how — is code in its market's package; what a deployment
 * decides about it is here: whether its figures are written yet, who decided, and how it has been
 * doing. A feed starts in SHADOW: nothing it reads becomes an official rate until an operator has
 * seen it read the live publication correctly and activates it.
 */
@Entity({ name: 'exchange_rate_feeds' })
@Check('CHK_exchange_rate_feeds_status', `"status" IN ('SHADOW', 'ACTIVE', 'DISABLED')`)
@Check('CHK_exchange_rate_feeds_failures', `"consecutive_failures" >= 0`)
export class ExchangeRateFeedState {
  @PrimaryColumn({ type: 'varchar', length: 40 })
  code: string;

  @Column({ type: 'varchar', length: 16, default: ExchangeRateFeedStatus.SHADOW })
  status: ExchangeRateFeedStatus;

  @Column({ name: 'status_changed_at', type: 'timestamptz', nullable: true })
  statusChangedAt: Date | null;

  @Column({ name: 'status_changed_by', type: 'uuid', nullable: true })
  statusChangedBy: string | null;

  @Column({ name: 'last_run_at', type: 'timestamptz', nullable: true })
  lastRunAt: Date | null;

  @Column({ name: 'last_success_at', type: 'timestamptz', nullable: true })
  lastSuccessAt: Date | null;

  @Column({ name: 'consecutive_failures', type: 'int', default: 0 })
  consecutiveFailures: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
