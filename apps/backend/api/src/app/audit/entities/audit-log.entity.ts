import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum ActionType {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  LOGIN_FAILED = 'LOGIN_FAILED',
  REFRESH = 'REFRESH',
  IMPERSONATE = 'IMPERSONATE',
  /**
   * Somebody looked at financial data.
   *
   * There was no way to express this, so there was no audit of access to financial information at
   * all — only of changes to it. In an accounting product that is half the requirement: who read
   * the payroll journal, who opened the ledger of a subsidiary they do not work on, who pulled the
   * customer list the week before resigning. None of it left a trace.
   *
   * Recorded only where a decorator asks for it, never on every GET: an audit trail that logs
   * every list refresh is one nobody can read.
   */
  READ = 'READ',
  /**
   * Financial data left the system — a CSV, a PDF, a fiscal return file.
   *
   * Distinguished from `READ` because it is a different event to an auditor and to a data
   * protection officer: reading a report is looking at it on screen; exporting it is taking a copy
   * away, and the copy outlives every access control this product has.
   */
  EXPORT = 'EXPORT',
}

@Entity({ name: 'audit_logs' })
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * The person responsible, or null when the system acted on its own.
   *
   * Depreciation, recurring entries and scheduled reversals post to the ledger with no user behind
   * them. While this column was NOT NULL those events could not be audited at all, so the choice
   * was between an unauditable posting and a fabricated author. `system_reason` on the payload
   * says which process acted.
   */
  @Index()
  @Column({ name: 'user_id', type: 'uuid', nullable: true, update: false })
  userId: string | null;

  @Index()
  @Column({ name: 'organization_id', type: 'uuid', nullable: true, update: false })
  organizationId?: string | null;

  @Index()
  @Column({ update: false })
  entity: string;

  @Index()
  @Column({ name: 'entity_id', update: false })
  entityId: string;

  @Column({ type: 'enum', enum: ActionType, update: false })
  actionType: ActionType;

  @Column({ name: 'ip_address', nullable: true, update: false })
  ipAddress?: string;

  @Column({ type: 'jsonb', name: 'previous_value', nullable: true, update: false })
  previousValue?: object;

  @Column({ type: 'jsonb', name: 'new_value', nullable: true, update: false })
  newValue: object | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', update: false })
  timestamp: Date;
}
