import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';

export type McpTokenKind = 'ACCESS' | 'REFRESH';

/** An access or refresh token of an MCP agent (only its hash), for one person in one company. */
@Entity({ name: 'mcp_oauth_tokens' })
@Unique('UQ_mcp_oauth_tokens_hash', ['tokenHash'])
@Index('IDX_mcp_oauth_tokens_user_org', ['userId', 'organizationId'])
@Index('IDX_mcp_oauth_tokens_family', ['familyId'])
@Check('CHK_mcp_oauth_tokens_kind', `"kind" IN ('ACCESS', 'REFRESH')`)
export class McpOAuthToken {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_mcp_oauth_tokens' })
  id: string;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash: string;

  @Column({ type: 'varchar', length: 8 })
  kind: McpTokenKind;

  /** Every token issued from one authorisation: revoking one (or reusing a spent refresh token) revokes all. */
  @Column({ name: 'family_id', type: 'uuid' })
  familyId: string;

  @Column({ name: 'client_id', type: 'varchar', length: 64 })
  clientId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  // By entity name: the AI module does not import identity's entity.
  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_mcp_oauth_tokens_user' })
  user?: unknown;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne('Organization', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_mcp_oauth_tokens_organization' })
  organization?: unknown;

  @Column({ type: 'varchar', length: 200 })
  scope: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
