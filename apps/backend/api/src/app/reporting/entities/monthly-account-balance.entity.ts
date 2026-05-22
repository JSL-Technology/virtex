
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';

@Entity({ name: 'monthly_account_balances' })
@Index(['organizationId', 'year', 'month'])
export class MonthlyAccountBalance {
  @PrimaryColumn({ type: 'uuid' })
  accountId: string;

  @PrimaryColumn({ type: 'int' })
  year: number;

  @PrimaryColumn({ type: 'int' })
  month: number;

  @PrimaryColumn({ type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0.0 })
  totalDebit: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0.0 })
  totalCredit: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0.0 })
  endBalance: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0.0 })
  netChange: number;
}