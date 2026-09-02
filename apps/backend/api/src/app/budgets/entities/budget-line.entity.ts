
import { Account } from '../../chart-of-accounts/entities/account.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { Budget } from './budget.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

@Entity({ name: 'budget_lines' })
export class BudgetLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Budget', 'lines', { onDelete: 'CASCADE' })
  budget: Budget;

  @Column({ name: 'account_id' })
  accountId: string;


  @ManyToOne(() => Account, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;


  @Column('decimal', { precision: 18, scale: 2, transformer: numericTransformerNotNull })
  amount: number;
  
  @Column({ type: 'jsonb', nullable: true })
  dimensions?: Record<string, string>;
}