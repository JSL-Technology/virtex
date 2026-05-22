
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';


export enum IntercompanyTransactionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity({ name: 'intercompany_transactions' })
export class IntercompanyTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'from_organization_id' })
  fromOrganizationId: string;

  @Column({ name: 'to_organization_id' })
  toOrganizationId: string;

  @Column('decimal', { precision: 18, scale: 2 })
  amount: number;

  @Column()
  currency: string;

  @Column()
  description: string;

  @CreateDateColumn({ name: 'transaction_date' })
  transactionDate: Date;
  
  @Column({ name: 'source_journal_entry_id' })
  sourceJournalEntryId: string;

  @Column({ name: 'destination_journal_entry_id', nullable: true })
  destinationJournalEntryId?: string;
  
  @Column({ type: 'enum', enum: IntercompanyTransactionStatus, default: IntercompanyTransactionStatus.PENDING })
  status: IntercompanyTransactionStatus;
}