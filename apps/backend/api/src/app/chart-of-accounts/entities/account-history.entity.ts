
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Account } from './account.entity';
import { User } from '../../users/entities/user.entity/user.entity';

/**
 * Every change to an account, and who made it.
 *
 * ## What was wrong with it
 *
 * The table carried each relation twice: `accountId` and `changedByUserId` held the values as
 * `NOT NULL` camelCase columns, while `account_id` and `changed_by_user_id` were the nullable
 * columns the foreign keys pointed at — and nothing ever wrote to those. The constraints therefore
 * enforced nothing: a history row could name an account that had been deleted, or a user who never
 * existed, and the database had no objection. Consolidated onto the constrained columns.
 */
@Entity({ name: 'account_history' })
@Index('IDX_account_history_account', ['accountId'])
export class AccountHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ type: 'jsonb' })
  previousValue: Partial<Account>;

  @Column({ type: 'jsonb' })
  newValue: Partial<Account>;

  @Column({ type: 'text' })
  reasonForChange: string;

  /** Null once the user's account is deleted; what changed and why is the record, and it stays. */
  @Column({ name: 'changed_by_user_id', type: 'uuid', nullable: true })
  changedByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'changed_by_user_id' })
  changedByUser: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  changedAt: Date;

  @Column({ type: 'int' })
  version: number;
}