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

export enum PaymentBatchStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  PAID = 'PAID',
  VOID = 'VOID',
}

/** One payment run: the bills it settled, the account the money left, and the entry it produced. */
@Entity({ name: 'payment_batches' })
@Index('IDX_payment_batches_org_date', ['organizationId', 'paymentDate'])
export class PaymentBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'payment_date', type: 'date' })
  paymentDate: Date;

  /** The account the funds left. A bank account, not a chart-of-accounts row. */
  @Column({ name: 'bank_account_id', type: 'uuid' })
  bankAccountId: string;

  @ManyToOne(() => BankAccount, { onDelete: 'RESTRICT' })
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => VendorPayment, (payment) => payment.paymentBatch, { cascade: true })
  payments: VendorPayment[];
}
