import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { Employee } from '../../hcm/entities/employee.entity';

export enum LeaveKind {
  VACATION = 'VACATION',
  SICK = 'SICK',
  MATERNITY = 'MATERNITY',
  PATERNITY = 'PATERNITY',
  BEREAVEMENT = 'BEREAVEMENT',
  MARRIAGE = 'MARRIAGE',
  UNPAID = 'UNPAID',
  OTHER = 'OTHER',
}

export enum LeaveStatus {
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

/** A period an employee is away: a vacation, a sick leave, a licence the law grants. */
@Entity({ name: 'employee_leaves' })
@Index('IDX_employee_leaves_org_employee', ['organizationId', 'employeeId', 'startDate'])
@Check('CHK_employee_leaves_kind', `"kind" IN ('VACATION', 'SICK', 'MATERNITY', 'PATERNITY', 'BEREAVEMENT', 'MARRIAGE', 'UNPAID', 'OTHER')`)
@Check('CHK_employee_leaves_status', `"status" IN ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED')`)
@Check('CHK_employee_leaves_dates', `"end_date" >= "start_date"`)
export class EmployeeLeave {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_employee_leaves' })
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_employee_leaves_organization')
  organization?: TenantRef;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id', foreignKeyConstraintName: 'FK_employee_leaves_employee' })
  employee?: Employee;

  @Column({ type: 'varchar', length: 16 })
  kind: LeaveKind;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  /** Working days the leave takes (weekends and fixed public holidays excluded). */
  @Column({ name: 'business_days', type: 'numeric', precision: 6, scale: 2, transformer: numericTransformerNotNull })
  businessDays: number;

  /** For a vacation: the service year (1 = the first anniversary) whose entitlement it consumes. */
  @Column({ name: 'service_year', type: 'integer', nullable: true })
  serviceYear: number | null;

  @Column({ type: 'varchar', length: 16, default: LeaveStatus.REQUESTED })
  status: LeaveStatus;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'decision_note', type: 'text', nullable: true })
  decisionNote: string | null;

  @Column({ name: 'requested_by_id', type: 'uuid', nullable: true })
  requestedById: string | null;

  @Column({ name: 'decided_by_id', type: 'uuid', nullable: true })
  decidedById: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
