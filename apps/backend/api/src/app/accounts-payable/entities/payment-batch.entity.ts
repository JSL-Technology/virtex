import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { VendorPayment } from './vendor-payment.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { BankAccount } from '../../treasury/entities/bank-account.entity';
import { BranchRef, IssuedAtBranch } from '../../organizations/contracts/branch.contract';

export enum PaymentBatchStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  PAID = 'PAID',
  VOID = 'VOID',
}

/** One payment run: the bills it settled, the account the money left, and the entry it produced. */
@Index('IDX_payment_batches_org_branch', ['organizationId', 'branchId'])
@Entity({ name: 'payment_batches' })
@Index('IDX_payment_batches_org_date', ['organizationId', 'paymentDate'])
@Index('UQ_payment_batches_org_number', ['organizationId', 'number'], { unique: true })
export class PaymentBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** `PAY-2026-000042`: what the supplier is told and the bank statement is matched against. */
  @Column({ type: 'varchar', length: 40 })
  number: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** The branch this was issued from — see `IssuedAtBranch`. Null for a company without branches, and for documents that predate them. */
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @IssuedAtBranch('FK_payment_batches_branch')
  branch?: BranchRef | null;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'payment_date', type: 'date' })
  paymentDate: Date;

  /** The account the funds left. A bank account, not a chart-of-accounts row. */
  @Column({ name: 'bank_account_id', type: 'uuid' })
  bankAccountId: string;

  /**
   * `CASCADE`, not `RESTRICT`.
   *
   * `RESTRICT` made the tenant undeletable: `organizations` cascades to the parent and PostgreSQL
   * does not promise to clear this child first, so `DELETE FROM organizations` aborted on any
   * tenant that had ever used the feature. Refusing to delete a parent still in use belongs in the
   * owning service, which can say why.
   */
  // ON DELETE RESTRICT (QA C-03): a document outlives any change of mind about the master data it
  // names. See migration ProtectReferencedMasterData.
  @ManyToOne(() => BankAccount, { onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
  @JoinColumn({ name: 'bank_account_id' })
  bankAccount: BankAccount;

  @Column({ name: 'reference', type: 'varchar', length: 80, nullable: true })
  reference: string | null;

  @Column({ type: 'enum', enum: PaymentBatchStatus, default: PaymentBatchStatus.PENDING })
  status: PaymentBatchStatus;

  /**
   * The ledger entry this run produced.
   *
   * Nothing linked a payment to its accounting before, so a payment could not be traced to the
   * ledger or reversed as a unit.
   */
  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  /** Why it was voided: a returned cheque, a transfer that bounced, a payment keyed in error. */
  @Column({ name: 'void_reason', type: 'text', nullable: true })
  voidReason: string | null;

  @Column({ name: 'voided_at', type: 'timestamptz', nullable: true })
  voidedAt: Date | null;

  @Column({ name: 'voided_by_user_id', type: 'uuid', nullable: true })
  voidedByUserId: string | null;

  @Column({ name: 'reversal_journal_entry_id', type: 'uuid', nullable: true })
  reversalJournalEntryId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => VendorPayment, (payment) => payment.paymentBatch, { cascade: true })
  payments: VendorPayment[];
}
