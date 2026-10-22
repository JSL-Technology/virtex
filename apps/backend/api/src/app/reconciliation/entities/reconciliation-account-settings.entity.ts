import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { BankAccount } from '../../treasury/entities/bank-account.entity';

/**
 * One bank account's reconciliation settings, over the company's. `null` inherits. `pausedAt` is
 * set when people undid too many of the matches confirmed without them; a person resumes it.
 */
@Entity({ name: 'reconciliation_account_settings' })
@Check('CHK_reconciliation_account_settings_min_score', `"min_score" IS NULL OR "min_score" BETWEEN 90 AND 100`)
export class ReconciliationAccountSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid', primaryKeyConstraintName: 'PK_reconciliation_account_settings' })
  organizationId: string;

  @TenantOwned('FK_reconciliation_account_settings_organization')
  organization?: TenantRef;

  @PrimaryColumn({ name: 'bank_account_id', type: 'uuid', primaryKeyConstraintName: 'PK_reconciliation_account_settings' })
  bankAccountId: string;

  @ManyToOne(() => BankAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bank_account_id', foreignKeyConstraintName: 'FK_reconciliation_account_settings_bank_account' })
  bankAccount?: BankAccount;

  @Column({ name: 'auto_confirm', type: 'boolean', nullable: true })
  autoConfirm: boolean | null;

  @Column({ name: 'min_score', type: 'integer', nullable: true })
  minScore: number | null;

  @Column({ name: 'paused_at', type: 'timestamptz', nullable: true })
  pausedAt: Date | null;

  @Column({ name: 'paused_reason', type: 'varchar', length: 64, nullable: true })
  pausedReason: string | null;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
