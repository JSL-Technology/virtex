
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

@Entity({ name: 'account_history' })
@Index(['accountId'])
export class AccountHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
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

  @Column({ type: 'uuid' })
  changedByUserId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'changed_by_user_id' })
  changedByUser: User;

  @CreateDateColumn({ type: 'timestamptz' })
  changedAt: Date;

  @Column({ type: 'int' })
  version: number;
}