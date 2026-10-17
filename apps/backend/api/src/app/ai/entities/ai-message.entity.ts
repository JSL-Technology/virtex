import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import type { AiConversation } from './ai-conversation.entity';

/**
 * One turn of a copilot conversation, exactly as it was sent or received: a later turn replays the
 * history byte for byte (thinking blocks are bound to the conversation that produced them).
 */
@Entity({ name: 'ai_messages' })
@Unique('UQ_ai_messages_conversation_seq', ['conversationId', 'seq'])
export class AiMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ai_messages_organization')
  organization?: TenantRef;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @ManyToOne('AiConversation', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id', foreignKeyConstraintName: 'FK_ai_messages_conversation' })
  conversation?: AiConversation;

  @Column({ type: 'integer' })
  seq: number;

  @Column({ type: 'varchar', length: 16 })
  role: 'user' | 'assistant';

  @Column({ type: 'jsonb' })
  content: unknown;

  /** Names of the tools an assistant turn called — the sources of its figures. */
  @Column({ name: 'tools_used', type: 'jsonb', default: [] })
  toolsUsed: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
