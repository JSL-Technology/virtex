
import { Ledger } from '../../accounting/entities/ledger.entity';
import { Entity, Column, ManyToOne, JoinColumn, PrimaryColumn, VersionColumn } from 'typeorm';
import { Account } from './account.entity';

@Entity({ name: 'account_balances' })
export class AccountBalance {
  @PrimaryColumn({ type: 'uuid', name: 'account_id' })
  accountId: string;

  @PrimaryColumn({ type: 'uuid', name: 'ledger_id' })
  ledgerId: string;

  @ManyToOne(() => Account, (account) => account.balances, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @ManyToOne(() => Ledger, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ledger_id' })
  ledger: Ledger;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0.0 })
  balance: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    name: 'balance_in_foreign_currency',
    comment: 'Balance in the original foreign currency, if applicable.',
  })
  balanceInForeignCurrency?: number;

  @Column({ name: 'last_updated_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  lastUpdatedAt: Date;


  @VersionColumn({ comment: 'Optimistic lock version to prevent race conditions' })
  version: number;
}
