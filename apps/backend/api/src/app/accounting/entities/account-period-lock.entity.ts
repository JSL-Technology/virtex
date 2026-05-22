
import { Entity, PrimaryColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { AccountingPeriod } from './accounting-period.entity';

@Entity({ name: 'account_period_locks' })
@Index(['organizationId', 'accountId', 'periodId'], { unique: true })
export class AccountPeriodLock {
  @PrimaryColumn({ type: 'uuid' })
  organizationId: string;

  @PrimaryColumn({ type: 'uuid' })
  accountId: string;

  @PrimaryColumn({ type: 'uuid' })
  periodId: string;

  @Column({ default: true })
  isLocked: boolean;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountId' })
  account: Account;

  @ManyToOne(() => AccountingPeriod, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'periodId' })
  period: AccountingPeriod;
}