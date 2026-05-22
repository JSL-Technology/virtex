import { Account } from '../chart-of-accounts/entities/account.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';

@Entity({ name: 'bank_transfers' })
export class BankTransfer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;
  
  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  amount: number;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'from_account_id' })
  fromAccount: Account;
  
  @Column({ name: 'from_account_id' })
  fromAccountId: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'to_account_id' })
  toAccount: Account;
  
  @Column({ name: 'to_account_id' })
  toAccountId: string;

  @Column()
  description: string;

  @Column({ nullable: true })
  reference?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}