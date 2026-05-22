
import { Account } from '../../chart-of-accounts/entities/account.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Budget } from './budget.entity';

@Entity({ name: 'budget_lines' })
export class BudgetLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Budget, (budget) => budget.lines, { onDelete: 'CASCADE' })
  budget: Budget;

  @Column({ name: 'account_id' })
  accountId: string;


  @ManyToOne(() => Account, { eager: true })
  @JoinColumn({ name: 'account_id' })
  account: Account;


  @Column('decimal', { precision: 18, scale: 2 })
  amount: number;
  
  @Column({ type: 'jsonb', nullable: true })
  dimensions?: Record<string, string>;
}