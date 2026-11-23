import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { Ledger } from './ledger.entity';
import type { InflationAdjustmentRunLine } from './inflation-adjustment-run-line.entity';

export enum InflationAdjustmentRunStatus {
  /** In the books: its entry is posted. */
  POSTED = 'POSTED',
  /** Undone: its entry was reversed, by hand or to be replaced by a newer run of the same month. */
  REVERSED = 'REVERSED',
}

/** The month of an index a run multiplied by, as it read it. */
export interface UsedIndexValue {
  value: string;
  revision: number;
  source: 'PLATFORM' | 'COMPANY';
  valueId: string;
}

/**
 * One restatement of a ledger for inflation, at the end of one month (IAS 29; audit 2026-11-07,
 * FIN-AC-04).
 *
 * The record of what the restatement did and why: the index of every month it multiplied by —
 * value, revision and source — the restated figure of each account and the entry that booked the
 * difference. A month is restated once: one POSTED run per ledger and month (the partial unique
 * index), so a double click, a retried request and a second close all find the first. A newer
 * figure for the month — a revised index, a late posting — replaces it: the run is reversed and a
 * new one posted, and both stay here.
 */
@Entity({ name: 'inflation_adjustment_runs' })
@Index('UQ_inflation_adjustment_runs_posted', ['organizationId', 'ledgerId', 'period'], {
  unique: true,
  where: `"status" = 'POSTED'`,
})
@Index('IDX_inflation_adjustment_runs_org_period', ['organizationId', 'period'])
@Check('CHK_inflation_adjustment_runs_status', `"status" IN ('POSTED', 'REVERSED')`)
@Check('CHK_inflation_adjustment_runs_period', `EXTRACT(DAY FROM "period") = 1`)
export class InflationAdjustmentRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_inflation_adjustment_runs_organization')
  organization?: TenantRef;

  @ManyToOne(() => Ledger, { nullable: false, onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
  @JoinColumn({ name: 'ledger_id', foreignKeyConstraintName: 'FK_inflation_adjustment_runs_ledger' })
  ledger?: Ledger;

  @Column({ name: 'ledger_id', type: 'uuid' })
  ledgerId: string;

  /** The month restated, as its first day; the entry is dated on its last. */
  @Column({ type: 'date' })
  period: string;

  @Column({ name: 'entry_date', type: 'date' })
  entryDate: string;

  @Column({ name: 'series_code', type: 'varchar', length: 40 })
  seriesCode: string;

  /** The index of the month restated: every amount is expressed in its unit. Exact decimal text. */
  @Column({ name: 'closing_index', type: 'numeric', precision: 30, scale: 10 })
  closingIndex: string;

  /** Every month the run multiplied by (`YYYY-MM` → value, revision, source). */
  @Column({ name: 'index_values', type: 'jsonb' })
  indexValues: Record<string, UsedIndexValue>;

  @Column({ type: 'varchar', length: 12, default: InflationAdjustmentRunStatus.POSTED })
  status: InflationAdjustmentRunStatus;

  /** The entry that booked the restatement; null when nothing needed restating. */
  @ManyToOne('JournalEntry', { nullable: true, onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
  @JoinColumn({ name: 'journal_entry_id', foreignKeyConstraintName: 'FK_inflation_adjustment_runs_entry' })
  journalEntry?: unknown;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @ManyToOne('JournalEntry', { nullable: true, onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
  @JoinColumn({ name: 'reversal_entry_id', foreignKeyConstraintName: 'FK_inflation_adjustment_runs_reversal' })
  reversalEntry?: unknown;

  @Column({ name: 'reversal_entry_id', type: 'uuid', nullable: true })
  reversalEntryId: string | null;

  /**
   * The gain (negative) or loss (positive) on the net monetary position it booked, debit-positive on
   * the account that takes it: what the restatement of everything else nets to (IAS 29.27).
   */
  @Column({ name: 'net_monetary_result', type: 'numeric', precision: 18, scale: 2, default: 0 })
  netMonetaryResult: string;

  @Column({ name: 'line_count', type: 'int', default: 0 })
  lineCount: number;

  @Column({ name: 'ran_by_user_id', type: 'uuid', nullable: true })
  ranByUserId: string | null;

  @CreateDateColumn({ name: 'ran_at', type: 'timestamptz' })
  ranAt: Date;

  @Column({ name: 'reversed_at', type: 'timestamptz', nullable: true })
  reversedAt: Date | null;

  @Column({ name: 'reversed_by_user_id', type: 'uuid', nullable: true })
  reversedByUserId: string | null;

  @Column({ name: 'reversal_reason', type: 'text', nullable: true })
  reversalReason: string | null;

  @OneToMany('InflationAdjustmentRunLine', 'run')
  lines?: InflationAdjustmentRunLine[];
}
