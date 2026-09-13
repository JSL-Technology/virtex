import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Check,
  Index,
} from 'typeorm';
import { CustomerPaymentLine } from './customer-payment-line.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { Customer } from './customer.entity';
import {
  numericTransformer,
  numericTransformerNotNull,
} from '../../common/database/numeric.transformer';
import { BankAccount } from '../../treasury/entities/bank-account.entity';

export enum CustomerPaymentStatus {
  POSTED = 'POSTED',
  /** Reversed — a bounced cheque, a returned transfer, a receipt issued in error. */
  VOID = 'VOID',
}

export enum PaymentMethod {
  CASH = 'CASH',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CHEQUE = 'CHEQUE',
  CARD = 'CARD',
  OTHER = 'OTHER',
}

/**
 * Money received from a customer.
 *
 * ## What it could not express
 *
 * The previous shape was organization, customer, date, bank account, reference, total and lines —
 * with the tenant, customer and bank account as bare `@Column()` strings carrying no relation, no
 * uuid type and no index. It had no currency, so a receipt against a foreign-currency invoice had
 * nowhere to record what it was worth; no status, so a bounced cheque could not be reversed; no
 * link to its journal entry, so it could not be traced to the ledger; and no notion of unapplied
 * cash, so a customer advance or an overpayment simply could not be recorded — every receipt had to
 * be applied, to the cent, against invoices that already existed.
 */
@Entity({ name: 'customer_payments' })
@Index('IDX_customer_payments_org_date', ['organizationId', 'paymentDate'])
@Index('IDX_customer_payments_customer', ['customerId'])
// "What does this customer have on account?" is asked on every receipt screen, and answered by
// summing every posted receipt for that customer in that currency.
@Index('IDX_customer_payment_advance_lookup', [
  'organizationId',
  'customerId',
  'currencyCode',
  'status',
])
// The invariant the service enforces, stated where the data lives: neither figure can go negative,
// so no future writer can quietly leave a customer holding a negative balance on account.
@Check(
  'CHK_customer_payment_advance_non_negative',
  '"advance_applied_amount" >= 0 AND "advance_applied_base_amount" >= 0',
)
export class CustomerPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  /** Human-facing receipt number, consecutive per tenant and year. */
  @Column({ name: 'receipt_number', type: 'varchar', length: 40, nullable: true })
  receiptNumber: string | null;

  @Column({ name: 'payment_date', type: 'date' })
  paymentDate: Date;

  /** The account the funds landed in. A bank account, not a chart-of-accounts row. */
  @Column({ name: 'bank_account_id', type: 'uuid' })
  bankAccountId: string;

  /**
   * `CASCADE`, not `RESTRICT`.
   *
   * `RESTRICT` here made the tenant undeletable: `organizations` cascades to the parent, and
   * PostgreSQL does not promise to clear this child first, so the delete aborted. Refusing to
   * delete a parent that is still in use is a rule the owning service states — with a message the
   * user can act on — rather than a constraint whose other effect is that offboarding a customer
   * is impossible.
   */
  @ManyToOne(() => BankAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bank_account_id' })
  bankAccount: BankAccount;

  @Column({ type: 'varchar', length: 120, nullable: true })
  reference: string | null;

  @Column({
    name: 'payment_method',
    type: 'enum',
    enum: PaymentMethod,
    default: PaymentMethod.BANK_TRANSFER,
  })
  paymentMethod: PaymentMethod;

  @Column({ name: 'currency_code', length: 3, default: 'USD' })
  currencyCode: string;

  /** Units of the books' currency per unit of `currencyCode`, on the day of the receipt. */
  @Column('decimal', {
    name: 'exchange_rate',
    precision: 18,
    scale: 6,
    default: 1,
    transformer: numericTransformerNotNull,
  })
  exchangeRate: number;

  /** Everything received, in `currencyCode`. */
  @Column('decimal', {
    name: 'total_amount',
    precision: 18,
    scale: 2,
    transformer: numericTransformerNotNull,
  })
  totalAmount: number;

  /**
   * Received but not yet applied to any invoice — a customer advance, or an overpayment.
   *
   * Carried as a liability until it is applied, because money held against no document is owed
   * back. Previously impossible to record: a receipt had to match invoices exactly.
   */
  @Column('decimal', {
    name: 'unapplied_amount',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  unappliedAmount: number;

  /**
   * Drawn from advances this customer had already paid, in `currencyCode`.
   *
   * The counterpart of `unappliedAmount`: one receipt creates the advance, a later one consumes it.
   * Without this column an advance could be received but never spent — the liability stayed on the
   * balance sheet for ever and the customer had to be asked to pay a second time for an invoice
   * their money was already sitting against.
   */
  @Column('decimal', {
    name: 'advance_applied_amount',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  advanceAppliedAmount: number;

  /**
   * What that draw was worth in the books' currency when it was taken.
   *
   * Advances are consumed at the weighted-average rate of what the customer actually paid, not at
   * the rate of the day they are spent, so the liability is retired for exactly what it was booked
   * at. Keeping the base figure is what makes that average computable without lot tracking; the gap
   * against the day's rate is recognised as a realised exchange difference, like any other.
   */
  @Column('decimal', {
    name: 'advance_applied_base_amount',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  advanceAppliedBaseAmount: number;

  @Column({
    type: 'enum',
    enum: CustomerPaymentStatus,
    default: CustomerPaymentStatus.POSTED,
  })
  status: CustomerPaymentStatus;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @Column({ name: 'reversal_journal_entry_id', type: 'uuid', nullable: true })
  reversalJournalEntryId: string | null;

  @Column({ name: 'void_reason', type: 'text', nullable: true })
  voidReason: string | null;

  @Column({ name: 'voided_at', type: 'timestamptz', nullable: true })
  voidedAt: Date | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @OneToMany(() => CustomerPaymentLine, (line) => line.payment, { cascade: true })
  lines: CustomerPaymentLine[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
