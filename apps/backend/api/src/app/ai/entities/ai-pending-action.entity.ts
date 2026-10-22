import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import type { AiConversation } from './ai-conversation.entity';

export type AiPendingActionStatus = 'PROPOSED' | 'COMMITTING' | 'CONFIRMED' | 'REJECTED' | 'FAILED' | 'EXPIRED';

/**
 * A document the copilot proposed to create. Nothing reaches the business tables until the person
 * who asked confirms it; this row keeps what they were shown, what they decided and what resulted.
 */
@Entity({ name: 'ai_pending_actions' })
@Index('IDX_ai_pending_actions_org_conversation', ['organizationId', 'conversationId'])
export class AiPendingAction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ai_pending_actions_organization')
  organization?: TenantRef;

  /** Null once the conversation is deleted: the proposal outlives it as the record of what was offered. */
  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId: string | null;

  @ManyToOne('AiConversation', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'conversation_id', foreignKeyConstraintName: 'FK_ai_pending_actions_conversation' })
  conversation?: AiConversation;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 64 })
  tool: string;

  @Column({ type: 'jsonb' })
  input: Record<string, unknown>;

  @Column({ type: 'text' })
  summary: string;

  @Column({ type: 'jsonb' })
  preview: Record<string, unknown>;

  @Column({ type: 'varchar', length: 16, default: 'PROPOSED' })
  status: AiPendingActionStatus;

  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;
}
