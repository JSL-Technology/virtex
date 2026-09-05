
import { Organization } from '../../organizations/entities/organization.entity';
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  OneToMany, 
  ManyToOne, 
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
  Index,
  Check,
} from 'typeorm';
import { BudgetLine } from './budget-line.entity';

/**
 * One budget per tenant per month, enforced by the database.
 *
 * There was no constraint, so a tenant could hold two budgets for March and `checkBudget`'s
 * `findOne` returned whichever PostgreSQL happened to produce. The control then enforced an
 * arbitrary one of them, and which one could change between two identical requests.
 *
 * The CHECK on `period` is the other half: the column is documented as `YYYY-MM` and the code
 * derives the key from the transaction date in exactly that shape, so a row stored as `2026-3` or
 * `March 2026` is never matched by anything and the budget silently does not apply.
 */
@Index('UQ_budgets_org_period', ['organizationId', 'period'], { unique: true })
@Check('CHK_budgets_period_format', `"period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`)
@Entity({ name: 'budgets' })
export class Budget {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  
  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column()
  name: string;

  @Column({ comment: 'Periodo del presupuesto en formato YYYY-MM' })
  period: string;

  @OneToMany(() => BudgetLine, (line) => line.budget, { cascade: true, eager: true })
  lines: BudgetLine[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;


  @VersionColumn()
  version: number;
}