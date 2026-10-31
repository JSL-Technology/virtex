import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { BranchRef, IssuedAtBranch } from '../../organizations/contracts/branch.contract';
import { Customer } from '../../customers/entities/customer.entity';

export enum RecurringFrequency {
  MONTHLY = 'MONTHLY',
  BIMONTHLY = 'BIMONTHLY',
  QUARTERLY = 'QUARTERLY',
  SEMIANNUAL = 'SEMIANNUAL',
  ANNUAL = 'ANNUAL',
}

export enum RecurringStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  /** Past its end date, or ended by hand. */
  ENDED = 'ENDED',
}

/** One line of what is billed each period. Priced at issue time from these values. */
export interface RecurringInvoiceLine {
  productId?: string | null;
  description?: string | null;
  quantity: number;
  unitPrice?: number | null;
  discountRate?: number | null;
}

/** An invoice issued on a schedule: an iguala, a rent, a maintenance contract. */
@Entity({ name: 'recurring_invoices' })
@Index('IDX_recurring_invoices_org_due', ['organizationId', 'status', 'nextRunDate'])
@Check('CHK_recurring_invoices_frequency', `"frequency" IN ('MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL')`)
@Check('CHK_recurring_invoices_status', `"status" IN ('ACTIVE', 'PAUSED', 'ENDED')`)
export class RecurringInvoice {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_recurring_invoices' })
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_recurring_invoices_organization')
  organization?: TenantRef;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @IssuedAtBranch('FK_recurring_invoices_branch')
  branch?: BranchRef | null;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @ManyToOne(() => Customer, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'customer_id', foreignKeyConstraintName: 'FK_recurring_invoices_customer' })
  customer?: Customer;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 16 })
  frequency: RecurringFrequency;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  /** The next date an invoice is due to be issued; null once it has ended. */
  @Column({ name: 'next_run_date', type: 'date', nullable: true })
  nextRunDate: string | null;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: string | null;

  @Column({ name: 'payment_term_days', type: 'integer', default: 0 })
  paymentTermDays: number;

  /** Issue (number, post, send to the DGII) at once; otherwise leave a draft for review. */
  @Column({ name: 'auto_issue', type: 'boolean', default: true })
  autoIssue: boolean;

  @Column({ name: 'currency_code', type: 'char', length: 3, nullable: true })
  currencyCode: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  lines: RecurringInvoiceLine[];

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 16, default: RecurringStatus.ACTIVE })
  status: RecurringStatus;

  @Column({ name: 'run_count', type: 'integer', default: 0 })
  runCount: number;

  @Column({ name: 'last_run_at', type: 'timestamptz', nullable: true })
  lastRunAt: Date | null;

  @Column({ name: 'last_invoice_id', type: 'uuid', nullable: true })
  lastInvoiceId: string | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

export enum RecurringRunStatus {
  CREATED = 'CREATED',
  FAILED = 'FAILED',
}

/** One scheduled issue of a recurring invoice. Unique per template and date. */
@Entity({ name: 'recurring_invoice_runs' })
@Unique('UQ_recurring_invoice_runs_template_date', ['recurringInvoiceId', 'runDate'])
@Check('CHK_recurring_invoice_runs_status', `"status" IN ('CREATED', 'FAILED')`)
export class RecurringInvoiceRun {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_recurring_invoice_runs' })
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_recurring_invoice_runs_organization')
  organization?: TenantRef;

  @Column({ name: 'recurring_invoice_id', type: 'uuid' })
  recurringInvoiceId: string;

  @ManyToOne(() => RecurringInvoice, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recurring_invoice_id', foreignKeyConstraintName: 'FK_recurring_invoice_runs_template' })
  recurringInvoice?: RecurringInvoice;

  @Column({ name: 'run_date', type: 'date' })
  runDate: string;

  @Column({ type: 'varchar', length: 16 })
  status: RecurringRunStatus;

  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoiceId: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
