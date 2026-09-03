import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

export enum BankAccountType {
  CHECKING = 'CHECKING',
  SAVINGS = 'SAVINGS',
  /** Petty cash or a till — not held at a bank, but reconciled the same way. */
  CASH = 'CASH',
  CREDIT_CARD = 'CREDIT_CARD',
}

/**
 * A real account at a real bank.
 *
 * ## Why this did not exist
 *
 * Treasury had one endpoint — `POST /treasury/bank-transfers` — whose `fromAccountId` and
 * `toAccountId` were ledger account ids. There was no bank, no account number, no currency of its
 * own, no opening balance and no holder: the product could move a number between two rows of the
 * chart of accounts and called it treasury.
 *
 * That is not a naming quibble. Without this entity there is nowhere to record which bank a
 * statement came from, no way to tell a USD account from a DOP one when both post to the same
 * control account, no cash position by account, and nothing for a reconciliation to belong to — the
 * bank statement upload had to take a raw GL account id and hope.
 *
 * The account number is stored in full because a bank reconciliation needs to match it against a
 * statement header; it is masked at the API boundary rather than truncated here, so the record
 * stays useful and the exposure stays controlled.
 */
@Entity({ name: 'bank_accounts' })
@Index('IDX_bank_accounts_org', ['organizationId'])
@Index('UQ_bank_accounts_org_number', ['organizationId', 'accountNumber'], {
  unique: true,
  where: '"account_number" IS NOT NULL',
})
export class BankAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  /** What the tenant calls it: "Popular corriente", "Caja chica sucursal norte". */
  @Column({ length: 120 })
  name: string;

  @Column({ name: 'bank_name', type: 'varchar', length: 120, nullable: true })
  bankName: string | null;

  @Column({ name: 'account_number', type: 'varchar', length: 60, nullable: true })
  accountNumber: string | null;

  /** IBAN where the market uses one; null across most of Latin America. */
  @Column({ type: 'varchar', length: 34, nullable: true })
  iban: string | null;

  @Column({ name: 'swift_bic', type: 'varchar', length: 11, nullable: true })
  swiftBic: string | null;

  @Column({
    name: 'account_type',
    type: 'enum',
    enum: BankAccountType,
    default: BankAccountType.CHECKING,
  })
  accountType: BankAccountType;

  /**
   * The currency the account is held in.
   *
   * Distinct from the ledger's. A DOP-based tenant with a USD account posts to a control account
   * measured in DOP while the statement arrives in USD, and nothing could express that before.
   */
  @Column({ name: 'currency_code', length: 3 })
  currencyCode: string;

  /**
   * The chart-of-accounts entry this bank account posts to.
   *
   * Several bank accounts may share one control account; the reverse is what breaks reconciliation,
   * so the relationship is deliberately many-to-one and not implied by equality of ids.
   */
  @Column({ name: 'gl_account_id', type: 'uuid' })
  glAccountId: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'gl_account_id' })
  glAccount: Account;

  /** Balance the account was opened with in this system, in `currencyCode`. */
  @Column('decimal', {
    name: 'opening_balance',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  openingBalance: number;

  @Column({ name: 'opening_date', type: 'date', nullable: true })
  openingDate: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
