import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ExchangeRateFeedState } from './exchange-rate-feed.entity';

export enum ExchangeRateFeedRunStatus {
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  /** Nothing was asked of the publisher: the process may not reach it, or a credential is missing. */
  SKIPPED = 'SKIPPED',
}

/** One figure a run read, and the day it is the official rate for. */
export interface FeedRunQuote {
  currency: string;
  publishedOn: string;
  effectiveOn: string;
  rate: number;
}

/**
 * Something a run found that an operator should look at: a figure that differs from the official
 * rate already on file, one held by another source, a publisher's revision of a day already
 * written, or a move larger than the feed's bound.
 */
export interface FeedRunDiscrepancy {
  kind: 'differs' | 'held_by_other_source' | 'revised' | 'jump';
  currency: string;
  effectiveOn: string;
  published: number;
  onFile: number | null;
  onFileSource: string | null;
}

/**
 * One reading of an official-rate feed: what the publisher said, what was written, and what did not
 * agree (FINB-03). Written once, when the run ends — the log of a feed is never edited.
 */
@Entity({ name: 'exchange_rate_feed_runs' })
@Index('IDX_exchange_rate_feed_runs_feed', ['feedCode', 'startedAt'])
@Check('CHK_exchange_rate_feed_runs_status', `"status" IN ('SUCCEEDED', 'FAILED', 'SKIPPED')`)
@Check('CHK_exchange_rate_feed_runs_trigger', `"trigger" IN ('SCHEDULE', 'OPERATOR')`)
@Check('CHK_exchange_rate_feed_runs_mode', `"mode" IN ('SHADOW', 'ACTIVE')`)
@Check('CHK_exchange_rate_feed_runs_range', `"range_from" <= "range_to"`)
@Check('CHK_exchange_rate_feed_runs_counts', `"written" >= 0 AND "unchanged" >= 0`)
export class ExchangeRateFeedRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'feed_code', type: 'varchar', length: 40 })
  feedCode: string;

  /** A reading belongs to a feed the deployment knows: its state row exists before its first reading. */
  @ManyToOne(() => ExchangeRateFeedState, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'feed_code', referencedColumnName: 'code', foreignKeyConstraintName: 'FK_exchange_rate_feed_runs_feed' })
  feed?: ExchangeRateFeedState;

  @Column({ type: 'varchar', length: 16 })
  trigger: 'SCHEDULE' | 'OPERATOR';

  @Column({ name: 'requested_by', type: 'uuid', nullable: true })
  requestedBy: string | null;

  /** Whether the run could write: a SHADOW run only reads and compares. */
  @Column({ type: 'varchar', length: 16 })
  mode: 'SHADOW' | 'ACTIVE';

  @Column({ name: 'range_from', type: 'date' })
  rangeFrom: string;

  @Column({ name: 'range_to', type: 'date' })
  rangeTo: string;

  @Column({ type: 'varchar', length: 16 })
  status: ExchangeRateFeedRunStatus;

  /** Why a run was skipped or failed, as a message key. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  reason: string | null;

  /** The reason's parameters: what was missing, what the publisher answered. */
  @Column({ type: 'jsonb', nullable: true })
  detail: Record<string, unknown> | null;

  @Column({ type: 'jsonb', default: [] })
  quotes: FeedRunQuote[];

  @Column({ type: 'int', default: 0 })
  written: number;

  @Column({ type: 'int', default: 0 })
  unchanged: number;

  @Column({ type: 'jsonb', default: [] })
  discrepancies: FeedRunDiscrepancy[];

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz' })
  finishedAt: Date;
}
