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

/**
 * A tenant's decision to install an extension and the capabilities it granted it.
 *
 * Tenant-scoped by `organizationId` to match the rest of the platform's isolation model. Execution
 * of a version that declares capabilities is refused unless a consent row for that tenant grants
 * every one of them — consent is the gate between "an extension exists in the catalogue" and "this
 * tenant lets it run privileged operations against their data".
 */
@Entity({ name: 'plugin_tenant_consents' })
@Index(['organizationId', 'plugin'], { unique: true })
export class TenantConsent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  organizationId: string;

  @ManyToOne(() => Plugin, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pluginId' })
  plugin: Plugin;

  @Column()
  pluginId: string;

  @Column({ type: 'simple-array', default: '' })
  grantedCapabilities: string[];

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
