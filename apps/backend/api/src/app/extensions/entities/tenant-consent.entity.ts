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

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
