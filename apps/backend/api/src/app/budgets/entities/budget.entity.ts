
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
  VersionColumn
} from 'typeorm';
import { BudgetLine } from './budget-line.entity';

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