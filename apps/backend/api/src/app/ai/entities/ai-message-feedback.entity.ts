import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import type { AiMessage } from './ai-message.entity';

export type AiMessageVerdict = 'UP' | 'DOWN' | 'REPORT';

/** What a person said about one of the assistant's answers: useful, not, or something to report. */
@Entity({ name: 'ai_message_feedback' })
@Unique('UQ_ai_message_feedback_message_user', ['messageId', 'userId'])
@Index('IDX_ai_message_feedback_org_created', ['organizationId', 'createdAt'])
@Check('CHK_ai_message_feedback_verdict', `"verdict" IN ('UP', 'DOWN', 'REPORT')`)
export class AiMessageFeedback {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_ai_message_feedback' })
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ai_message_feedback_organization')
  organization?: TenantRef;

  @Column({ name: 'message_id', type: 'uuid' })
  messageId: string;

  @ManyToOne('AiMessage', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id', foreignKeyConstraintName: 'FK_ai_message_feedback_message' })
  message?: AiMessage;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 8 })
  verdict: AiMessageVerdict;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
