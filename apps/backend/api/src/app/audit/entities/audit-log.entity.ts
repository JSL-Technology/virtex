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
