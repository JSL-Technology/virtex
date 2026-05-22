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

  @Index()
  @Column({ name: 'user_id', type: 'uuid', updatable: false })
  userId: string;

  @Index()
  @Column({ updatable: false })
  entity: string;

  @Index()
  @Column({ name: 'entity_id', updatable: false })
  entityId: string;

  @Column({ type: 'enum', enum: ActionType, updatable: false })
  actionType: ActionType;

  @Column({ name: 'ip_address', nullable: true, updatable: false })
  ipAddress?: string;

  @Column({ type: 'jsonb', name: 'previous_value', nullable: true, updatable: false })
  previousValue?: object;

  @Column({ type: 'jsonb', name: 'new_value', nullable: true, updatable: false })
  newValue: object | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', updatable: false })
  timestamp: Date;
}
