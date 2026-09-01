
import { Entity, PrimaryGeneratedColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';

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
  /**
   * `uuid`, matching `organizations.id`, with a foreign key.
   *
   * Twenty tables held the tenant reference as `character varying` while the column it points at
   * is a uuid. A join between them was a type error PostgreSQL refused outright, and a row whose
   * organization had been deleted was perfectly storable.
   */
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

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