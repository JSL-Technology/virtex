import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

/** One copilot thread. Owned by one user: the service never lists another person's threads. */
@Entity({ name: 'ai_conversations' })
@Index('IDX_ai_conversations_org_user_updated', ['organizationId', 'userId', 'updatedAt'])
@Index('IDX_ai_conversations_org_updated', ['organizationId', 'updatedAt'])
export class AiConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ai_conversations_organization')
  organization?: TenantRef;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 200, default: '' })
  title: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
