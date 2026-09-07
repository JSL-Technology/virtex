import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One attempt at a business transition, remembered so a retry cannot repeat it.
 *
 * The row is written BEFORE the handler runs, not after. That ordering is the whole mechanism: the
 * unique index on (organization_id, key) is what makes two concurrent requests race against the
 * database instead of against each other, and the loser learns it lost rather than posting a second
 * journal entry.
 */
@Entity({ name: 'idempotency_records' })
@Index('UQ_idempotency_org_key', ['organizationId', 'key'], { unique: true })
export class IdempotencyRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** The client's `Idempotency-Key` header. Opaque to the server. */
  @Column({ type: 'varchar', length: 255 })
  key!: string;

  /** `POST /invoices/:id/issue`. A key is scoped to the route it was first used on. */
  @Column({ name: 'endpoint', type: 'varchar', length: 255 })
  endpoint!: string;

  /**
   * SHA-256 of the request body.
   *
   * Reusing a key with a different body is not a retry; it is a different request wearing the same
   * name, and answering it with the first one's result would be worse than either executing or
   * refusing. It is refused.
   */
  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'in_progress' })
  status!: 'in_progress' | 'completed';

  @Column({ name: 'response_status', type: 'int', nullable: true })
  responseStatus!: number | null;

  @Column({ name: 'response_body', type: 'jsonb', nullable: true })
  responseBody!: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
