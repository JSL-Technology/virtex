import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { BankAccount } from './bank-account.entity';
import { JournalEntry } from '../../journal-entries/entities/journal-entry.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

/**
 * A movement of funds between two of the tenant's own accounts.
 *
 * ## What changed and why
 *
 * `from_account_id` and `to_account_id` were **chart-of-accounts** ids, so the record could not say
 * which bank the money left: two accounts at different banks sharing one control account produced
 * two indistinguishable rows. They are bank accounts now.
 *
 * `amount` was the only figure, which made a cross-currency transfer unrecordable — what left the
 * source and what reached the destination are two different numbers, and their difference is a
 * realised exchange effect that has to be booked. `amount_received` and `fee` carry those, and
 * `journal_entry_id` ties the row to the entry that put it in the ledger, which nothing did before:
 * the transfer and its accounting were two unrelated records.
 */
@Entity({ name: 'bank_transfers' })
@Index('IDX_bank_transfers_org_date', ['organizationId', 'date'])
export class BankTransfer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'date' })
  date: Date;

  /** What left the source account, in the source account's currency. */
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    transformer: numericTransformerNotNull,
  })
  amount: number;

  /**
   * What reached the destination, in the destination account's currency.
   *
   * Equal to `amount − fee` for a same-currency transfer; stated by the caller otherwise, because
   * no single rate describes what the bank actually did on both sides.
   */
  @Column({
    name: 'amount_received',
    type: 'decimal',
    precision: 18,
    scale: 2,
    transformer: numericTransformerNotNull,
  })
  amountReceived: number;

  /** Bank charge deducted from the transfer, in the source account's currency. */
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  fee: number;

  @Column({ name: 'from_bank_account_id', type: 'uuid' })
  fromBankAccountId: string;

  @ManyToOne(() => BankAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'from_bank_account_id' })
  fromBankAccount: BankAccount;

  @Column({ name: 'to_bank_account_id', type: 'uuid' })
  toBankAccountId: string;

  @ManyToOne(() => BankAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'to_bank_account_id' })
  toBankAccount: BankAccount;

  @Column({ type: 'varchar', length: 500 })
  description: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  reference: string | null;

  /** The entry this transfer produced. Null only while the enclosing transaction is still open. */
  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @ManyToOne(() => JournalEntry, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'journal_entry_id' })
  journalEntry: JournalEntry | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
