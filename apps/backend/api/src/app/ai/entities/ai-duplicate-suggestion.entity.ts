import { Check, Column, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import type { DuplicateEntityType } from '../../contracts/data-quality/duplicate-sources.contract';

export type DuplicateStatus = 'OPEN' | 'SAME' | 'NOT_DUPLICATE' | 'STALE';

/** Two records that are probably one, and what a person decided about them. */
@Entity({ name: 'ai_duplicate_suggestions' })
@Unique('UQ_ai_duplicate_suggestions_pair', ['organizationId', 'entityType', 'recordAId', 'recordBId'])
@Index('IDX_ai_duplicate_suggestions_org_status', ['organizationId', 'status', 'entityType'])
@Check('CHK_ai_duplicate_suggestions_type', `"entity_type" IN ('CUSTOMER', 'SUPPLIER', 'PRODUCT')`)
@Check('CHK_ai_duplicate_suggestions_status', `"status" IN ('OPEN', 'SAME', 'NOT_DUPLICATE', 'STALE')`)
@Check('CHK_ai_duplicate_suggestions_order', `"record_a_id" < "record_b_id"`)
export class AiDuplicateSuggestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ai_duplicate_suggestions_organization')
  organization?: TenantRef;

  @Column({ name: 'entity_type', type: 'varchar', length: 16 })
  entityType: DuplicateEntityType;

  /** The smaller id of the pair, so a pair is stored once whichever way it was found. */
  @Column({ name: 'record_a_id', type: 'uuid' })
  recordAId: string;

  @Column({ name: 'record_b_id', type: 'uuid' })
  recordBId: string;

  @Column({ name: 'label_a', type: 'varchar', length: 300, default: '' })
  labelA: string;

  @Column({ name: 'label_b', type: 'varchar', length: 300, default: '' })
  labelB: string;

  @Column({ type: 'numeric', precision: 6, scale: 4, transformer: numericTransformerNotNull })
  score: number;

  @Column({ type: 'jsonb', default: [] })
  reasons: string[];

  @Column({ type: 'varchar', length: 16, default: 'OPEN' })
  status: DuplicateStatus;

  @Column({ name: 'decided_by_user_id', type: 'uuid', nullable: true })
  decidedByUserId: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'detected_at', type: 'timestamptz', default: () => 'now()' })
  detectedAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
