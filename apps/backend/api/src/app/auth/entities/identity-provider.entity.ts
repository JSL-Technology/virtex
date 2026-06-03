import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum IdentityProviderType {
  OIDC = 'oidc',
  // SAML reserved for a future phase.
  SAML = 'saml',
}

/**
 * A per-organization enterprise SSO identity provider (Phase 2). Each customer configures
 * their own IdP (Okta, Microsoft Entra, Google Workspace, Ping, Auth0, ...). The IAM in this
 * app remains the source of truth — the IdP only verifies the user's email once per login.
 *
 * The client secret is stored ENCRYPTED at rest (AES-256-GCM via SecretEncryptionService);
 * it is never returned to the client.
 */
@Entity({ name: 'identity_providers' })
@Index(['organizationId'])
export class IdentityProvider {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ length: 120 })
  name: string;

  @Column({ type: 'enum', enum: IdentityProviderType, default: IdentityProviderType.OIDC })
  type: IdentityProviderType;

  /** OIDC issuer / discovery base URL (parent of `.well-known/openid-configuration`). */
  @Column({ name: 'issuer_url' })
  issuerUrl: string;

  @Column({ name: 'client_id' })
  clientId: string;

  /** AES-256-GCM ciphertext of the client secret. Never exposed via the API. */
  @Column({ name: 'client_secret_encrypted', type: 'text' })
  clientSecretEncrypted: string;

  @Column({ type: 'simple-array', default: 'openid,email,profile' })
  scopes: string[];

  /** Role assigned to JIT-provisioned users. If null, the org's default member role is used. */
  @Column({ name: 'default_role_id', type: 'uuid', nullable: true })
  defaultRoleId: string | null;

  /** Disabled until the owning domain is verified and an admin turns it on. */
  @Column({ default: false })
  enabled: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
