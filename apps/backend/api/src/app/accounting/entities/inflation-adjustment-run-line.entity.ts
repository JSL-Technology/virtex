import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { InflationAdjustmentRun } from './inflation-adjustment-run.entity';

/**
 * What a restatement run found for one account — and one combination of its dimension tags: the
 * historical amount, the same amounts restated from the month each originated, what the books
 * already carried, and the difference it booked.
 */
@Entity({ name: 'inflation_adjustment_run_lines' })
@Index('IDX_inflation_adjustment_run_lines_run', ['runId'])
export class InflationAdjustmentRunLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_inflation_adjustment_run_lines_organization')
  organization?: TenantRef;

  @ManyToOne(() => InflationAdjustmentRun, (run) => run.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id', foreignKeyConstraintName: 'FK_inflation_adjustment_run_lines_run' })
  run?: InflationAdjustmentRun;

  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  /** The account restated. */
  @ManyToOne(() => Account, { nullable: false, onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
  @JoinColumn({ name: 'account_id', foreignKeyConstraintName: 'FK_inflation_adjustment_run_lines_account' })
  account?: Account;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  /** Where the difference was posted: the account itself, or its restatement account. */
  @ManyToOne(() => Account, { nullable: false, onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
  @JoinColumn({ name: 'posted_account_id', foreignKeyConstraintName: 'FK_inflation_adjustment_run_lines_posted_account' })
  postedAccount?: Account;

  @Column({ name: 'posted_account_id', type: 'uuid' })
  postedAccountId: string;

  @Column({ type: 'jsonb', nullable: true })
  dimensions: Record<string, string> | null;

  /** The amounts at their historical value, debit-positive. */
  @Column({ type: 'numeric', precision: 18, scale: 2 })
  historical: string;

  /** The same amounts, each restated from the month it originated. */
  @Column({ type: 'numeric', precision: 18, scale: 2 })
  restated: string;

  /** What the books carried before the run, restatements already posted included. */
  @Column({ name: 'book_balance', type: 'numeric', precision: 18, scale: 2 })
  bookBalance: string;

  /** `restated − bookBalance`: the line the run posted. */
  @Column({ type: 'numeric', precision: 18, scale: 2 })
  adjustment: string;

  /** The earliest month any of its amounts originated in. */
  @Column({ name: 'earliest_origin', type: 'date', nullable: true })
  earliestOrigin: string | null;
}
