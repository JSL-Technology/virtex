import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, ValueTransformer } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

/** What became of a call. `REFUSED` is the model declining; `FAILED` is everything else going wrong. */
export type AiRequestStatus = 'SUCCEEDED' | 'REFUSED' | 'FAILED' | 'CANCELLED';

/** `pg` returns `bigint` as a string; the amounts here are far below 2^53, so a number is exact. */
const bigintAsNumber: ValueTransformer = {
  to: (value?: number | null) => value ?? 0,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};

/**
 * One call to a language or embedding model.
 *
 * The same row is the audit trail (who asked what, when, through which feature), the cost ledger
 * (tokens and dollars, per tenant) and the quota counter (credits consumed in the period). Keeping
 * the three in one place is deliberate: a usage screen, an invoice for overage and an audit query
 * read the same numbers, so they cannot disagree.
 *
 * Nothing the user sent is stored — only a hash of it, enough to recognise a repeated request and
 * to correlate a complaint with a call without keeping a copy of their documents.
 */
@Entity({ name: 'ai_requests' })
@Index('IDX_ai_requests_org_created', ['organizationId', 'createdAt'])
export class AiRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ai_requests_organization')
  organization?: TenantRef;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  /** The product feature that made the call: `product_vision`, `anomaly_narrative`… */
  @Column({ type: 'varchar', length: 64 })
  feature: string;

  @Column({ type: 'varchar', length: 32 })
  provider: string;

  @Column({ type: 'varchar', length: 64 })
  model: string;

  @Column({ type: 'varchar', length: 16 })
  status: AiRequestStatus;

  @Column({ name: 'stop_reason', type: 'varchar', length: 32, nullable: true })
  stopReason: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 64, nullable: true })
  errorCode: string | null;

  @Column({ name: 'input_tokens', type: 'integer', default: 0 })
  inputTokens: number;

  @Column({ name: 'output_tokens', type: 'integer', default: 0 })
  outputTokens: number;

  @Column({ name: 'cache_read_tokens', type: 'integer', default: 0 })
  cacheReadTokens: number;

  @Column({ name: 'cache_write_tokens', type: 'integer', default: 0 })
  cacheWriteTokens: number;

  /** Cost in millionths of a US dollar: integers, so a month of calls sums without rounding. */
  @Column({ name: 'cost_micro_usd', type: 'bigint', default: 0, transformer: bigintAsNumber })
  costMicroUsd: number;

  /** Plan credits consumed. What the tenant's quota is measured in; see `AI_CREDIT_COST`. */
  @Column({ type: 'integer', default: 0 })
  credits: number;

  @Column({ name: 'latency_ms', type: 'integer', default: 0 })
  latencyMs: number;

  @Column({ name: 'input_hash', type: 'char', length: 64, nullable: true })
  inputHash: string | null;

  /** Which instructions the call used (`copilot.system`, `bill_capture.system`…). */
  @Column({ name: 'prompt_id', type: 'varchar', length: 64, nullable: true })
  promptId: string | null;

  /** The first 16 hex characters of the SHA-256 of the system prompt as sent: its version. */
  @Column({ name: 'prompt_hash', type: 'char', length: 16, nullable: true })
  promptHash: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
