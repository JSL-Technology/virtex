import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Plugin } from './plugin.entity';
import { Organization } from '../../organizations/entities/organization.entity';

/**
 * A tenant's decision to install an extension and the capabilities it granted it.
 *
 * Tenant-scoped by `organizationId` to match the rest of the platform's isolation model. Execution
 * of a version that declares capabilities is refused unless a consent row for that tenant grants
 * every one of them — consent is the gate between "an extension exists in the catalogue" and "this
 * tenant lets it run privileged operations against their data".
 */
@Entity({ name: 'plugin_tenant_consents' })
@Index('UQ_plugin_consent_org_plugin', ['organizationId', 'pluginId'], { unique: true })
export class TenantConsent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_plugin_consent_org')
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'organization_id',
    foreignKeyConstraintName: 'FK_plugin_consent_organization',
  })
  organization: Organization;

  @ManyToOne(() => Plugin, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pluginId', foreignKeyConstraintName: 'FK_plugin_consent_plugin' })
  plugin: Plugin;

  @Column({ type: 'uuid' })
  pluginId: string;

  @Column({ type: 'simple-array', default: '' })
  grantedCapabilities: string[];

  /**
   * The exact version this tenant agreed to run.
   *
   * Without it, consent was to a NAME, and execution resolved "the most recent version" — so a
   * version published after the tenant consented inherited that consent and its capabilities
   * automatically. Whoever could add a version to the catalogue could therefore run code in every
   * tenant that had ever installed the extension, under the rights those tenants had granted the
   * version they actually reviewed.
   *
   * Pinning makes a new version a PROPOSAL: it sits in the catalogue until the tenant consents to
   * it. `pendingVersionId` below is where that proposal waits.
   *
   * NULL only for rows written before this column existed; `resolveVersion` treats a consent with
   * no pin as consenting to the newest version at the time it is first read, and pins it then, so
   * the estate converges without a data migration that would have to guess.
   */
  @Column({ name: 'consented_version_id', type: 'uuid', nullable: true })
  consentedVersionId: string | null;

  /**
   * A newer version the publisher has released and this tenant has not yet accepted.
   *
   * Surfaced to the tenant so the upgrade is a decision they make, and never executed until
   * `consentedVersionId` is moved to it.
   */
  @Column({ name: 'pending_version_id', type: 'uuid', nullable: true })
  pendingVersionId: string | null;

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
