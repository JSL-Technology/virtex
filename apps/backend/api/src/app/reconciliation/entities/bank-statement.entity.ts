import { Account } from '../../chart-of-accounts/entities/account.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BankTransaction } from './bank-transaction.entity';

export enum StatementStatus {
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity({ name: 'bank_statements' })
export class BankStatement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'account_id' })
  accountId: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ name: 'file_name' })
  fileName: string;
  
  @Column({ type: 'date', name: 'start_date' })
  startDate: Date;

  @Column({ type: 'date', name: 'end_date' })
  endDate: Date;
  
  @Column({ type: 'decimal', precision: 18, scale: 2, name: 'starting_balance' })
  startingBalance: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, name: 'ending_balance' })
  endingBalance: number;

  @Column({ type: 'enum', enum: StatementStatus, default: StatementStatus.PROCESSING })
  status: StatementStatus;

  @OneToMany(() => BankTransaction, (transaction) => transaction.statement, { cascade: true })
  transactions: BankTransaction[];
  
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
