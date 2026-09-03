import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { BankAccount } from '../../treasury/entities/bank-account.entity';
import { BankTransaction } from './bank-transaction.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

export enum StatementStatus {
  /** The file is being read. */
  IMPORTING = 'IMPORTING',
  /** Transactions are loaded and matching can begin. */
  IMPORTED = 'IMPORTED',
  /** The file could not be read; `importError` says why. */
  FAILED = 'FAILED',
  /** Closed: every transaction accounted for and the balance proof at zero. */
  RECONCILED = 'RECONCILED',
}

/**
 * One bank statement, for one bank account, over one date range.
 *
 * ## What changed
 *
 * `account_id` was a **chart-of-accounts** id, so a statement belonged to a control account rather
 * than to an account at a bank. Four accounts posting to `1102 Bancos` produced four statements
 * indistinguishable from one another, and nothing could tell which of them a transaction had
 * cleared through. It points at a bank account now.
 *
 * `starting_balance` and `ending_balance` were stored and never read. They are the whole point of a
 * reconciliation — the proof is *book balance, adjusted, equals statement balance, adjusted* — so
 * the module could record matches but could never say whether the account actually reconciled.
 * `RECONCILED` is a state a statement can only reach through that proof.
 */
@Entity({ name: 'bank_statements' })
@Index('IDX_bank_statements_org_account', ['organizationId', 'bankAccountId'])
@Index('UQ_bank_statements_file_hash', ['organizationId', 'bankAccountId', 'fileHash'], {
  unique: true,
  where: '"file_hash" IS NOT NULL AND "status" <> \'FAILED\'',
})
export class BankStatement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'bank_account_id', type: 'uuid' })
  bankAccountId: string;

  @ManyToOne(() => BankAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bank_account_id' })
  bankAccount: BankAccount;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  /**
   * SHA-256 of the uploaded bytes.
   *
   * Uploading the same file twice used to load every transaction a second time, and both copies
   * were matchable — the second set against ledger lines the first had already cleared.
   */
  @Column({ name: 'file_hash', type: 'char', length: 64, nullable: true })
  fileHash: string | null;

  @Column({ type: 'date', name: 'start_date' })
  startDate: string;

  @Column({ type: 'date', name: 'end_date' })
  endDate: string;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    name: 'starting_balance',
    transformer: numericTransformerNotNull,
  })
  startingBalance: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    name: 'ending_balance',
    transformer: numericTransformerNotNull,
  })
  endingBalance: number;

  @Column({ type: 'enum', enum: StatementStatus, default: StatementStatus.IMPORTING })
  status: StatementStatus;

  /** Why the import failed. Recorded, rather than left to the log, so the uploader can see it. */
  @Column({ name: 'import_error', type: 'text', nullable: true })
  importError: string | null;

  @Column({ name: 'reconciled_at', type: 'timestamptz', nullable: true })
  reconciledAt: Date | null;

  @Column({ name: 'reconciled_by_user_id', type: 'uuid', nullable: true })
  reconciledByUserId: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @OneToMany(() => BankTransaction, (transaction) => transaction.statement, {
    cascade: true,
  })
  transactions: BankTransaction[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
