
import { Account } from '../../chart-of-accounts/entities/account.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import type { Budget } from './budget.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

/**
 * One line per budget, account and dimension combination.
 *
 * `findMatchingBudgetLine` takes the first match, so two lines for the same account and the same
 * cost centre meant the control enforced whichever was returned first and the other was invisible —
 * including to whoever entered it.
 */
@Index('UQ_budget_lines_budget_account_dimensions', ['budgetId', 'accountId', 'dimensions'], {
  unique: true,
})
@Entity({ name: 'budget_lines' })
export class BudgetLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Budget', 'lines', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'budget_id', foreignKeyConstraintName: 'FK_budget_lines_budget' })
  budget: Budget;

  @Column({ name: 'budget_id', type: 'uuid' })
  budgetId: string;

  @Column({ name: 'account_id' })
  accountId: string;


  @ManyToOne(() => Account, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;


  @Column('decimal', { precision: 18, scale: 2, transformer: numericTransformerNotNull })
  amount: number;
  
  /**
   * Not nullable. A unique index treats two NULLs as distinct, so a nullable column would let the
   * same account be budgeted twice at the account level — exactly the duplicate the index exists to
   * prevent. The empty object is the same fact stated in a form the database can compare.
   */
  @Column({ type: 'jsonb' })
  dimensions: Record<string, string>;
}