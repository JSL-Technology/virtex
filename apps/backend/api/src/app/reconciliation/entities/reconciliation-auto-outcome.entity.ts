import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

/**
 * A match confirmed without a person, its score, and whether someone undid it. No foreign key to
 * the match: undoing deletes the match, and this row is the record that it was undone.
 */
@Entity({ name: 'reconciliation_auto_outcomes' })
@Unique('UQ_reconciliation_auto_outcomes_match', ['matchId'])
@Index('IDX_reconciliation_auto_outcomes_account', ['organizationId', 'bankAccountId', 'createdAt'])
export class ReconciliationAutoOutcome {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_reconciliation_auto_outcomes' })
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_reconciliation_auto_outcomes_organization')
  organization?: TenantRef;

  @Column({ name: 'match_id', type: 'uuid' })
  matchId: string;

  @Column({ name: 'bank_account_id', type: 'uuid' })
  bankAccountId: string;

  @Column({ name: 'statement_id', type: 'uuid' })
  statementId: string;

  @Column({ type: 'integer' })
  score: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'undone_at', type: 'timestamptz', nullable: true })
  undoneAt: Date | null;

  @Column({ name: 'undone_by_user_id', type: 'uuid', nullable: true })
  undoneByUserId: string | null;
}
