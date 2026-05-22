
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

export enum PeriodStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum ModuleSlug {
    GL = 'general-ledger',
    AP = 'accounts-payable',
    AR = 'accounts-receivable',
    INVENTORY = 'inventory',
}

@Entity({ name: 'accounting_periods' })
export class AccountingPeriod {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column()
  name: string;

  @Column({ type: 'date', name: 'start_date' })
  startDate: Date;

  @Column({ type: 'date', name: 'end_date' })
  endDate: Date;
  
  @Column({ type: 'enum', enum: PeriodStatus, default: PeriodStatus.OPEN })
  status: PeriodStatus;


  @Column({ name: 'gl_status', type: 'enum', enum: PeriodStatus, default: PeriodStatus.OPEN })
  generalLedgerStatus: PeriodStatus;

  @Column({ name: 'ap_status', type: 'enum', enum: PeriodStatus, default: PeriodStatus.OPEN })
  accountsPayableStatus: PeriodStatus;

  @Column({ name: 'ar_status', type: 'enum', enum: PeriodStatus, default: PeriodStatus.OPEN })
  accountsReceivableStatus: PeriodStatus;

  @Column({ name: 'inv_status', type: 'enum', enum: PeriodStatus, default: PeriodStatus.OPEN })
  inventoryStatus: PeriodStatus;
  

  @Column({ name: 'reopening_journal_entry_id', type: 'uuid', nullable: true })
  reopeningJournalEntryId?: string | null;
}