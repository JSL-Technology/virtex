import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** An MCP agent registered dynamically (RFC 7591): a public client, PKCE only, no secret. */
@Entity({ name: 'mcp_oauth_clients' })
@Unique('UQ_mcp_oauth_clients_client_id', ['clientId'])
export class McpOAuthClient {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_mcp_oauth_clients' })
  id: string;

  @Column({ name: 'client_id', type: 'varchar', length: 64 })
  clientId: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ name: 'redirect_uris', type: 'jsonb' })
  redirectUris: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
