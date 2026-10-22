import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

/** A one-time authorisation code (only its hash), bound to client, redirect address and PKCE challenge. */
@Entity({ name: 'mcp_oauth_codes' })
export class McpOAuthCode {
  @PrimaryColumn({ name: 'code_hash', type: 'char', length: 64, primaryKeyConstraintName: 'PK_mcp_oauth_codes' })
  codeHash: string;

  @Column({ name: 'client_id', type: 'varchar', length: 64 })
  clientId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  // By entity name: the AI module does not import identity's entity.
  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_mcp_oauth_codes_user' })
  user?: unknown;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne('Organization', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_mcp_oauth_codes_organization' })
  organization?: unknown;

  @Column({ name: 'redirect_uri', type: 'varchar', length: 2000 })
  redirectUri: string;

  @Column({ name: 'code_challenge', type: 'varchar', length: 128 })
  codeChallenge: string;

  @Column({ type: 'varchar', length: 200 })
  scope: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
