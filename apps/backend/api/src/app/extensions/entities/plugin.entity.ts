import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PluginVersion } from './plugin-version.entity';

export enum PluginStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
  REVOKED = 'REVOKED',
}

/**
 * A marketplace extension.
 *
 * The catalogue of extensions is global — an extension is authored once and offered to every
 * tenant — so this table is not tenant-scoped. What a tenant may *do* with an extension (install
 * it, grant it capabilities) lives in {@link TenantConsent}, which is tenant-scoped, and what it
 * *cost* a tenant to run lives in {@link MeteringRecord}. Keeping the catalogue separate from
 * consent is what lets one signed, admitted artefact be reused across tenants without re-review.
 */
/*
 * The names and the types are the migration's, not TypeORM's defaults.
 *
 * `1789002200000-Extensions.ts` built these tables with `uuid` keys, `timestamptz` stamps and
 * hand-named indexes and foreign keys. The entities said `@Column()` — which reflect-metadata
 * resolves to `varchar` — and `@Index()` without a name, so `check:schema-drift` proposed dropping
 * and re-adding every key column (losing the rows) and renaming every index and constraint, on
 * every run. Declaring what the migration actually built is what makes the check meaningful.
 */
@Entity({ name: 'plugins' })
export class Plugin {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('UQ_plugins_name', { unique: true })
  @Column({ length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  author: string | null;

  /**
   * The organization that published this extension, when it was published by a tenant.
   *
   * The catalogue is global, and that is correct — an extension is authored once and offered to
   * everyone. What was missing is WHO may write each row. `register` looked a plugin up by name
   * and, if it existed, appended a version to it, with no check at all on who was appending: any
   * tenant administrator could publish a new version of any extension in the catalogue, and since
   * the newest version is the one that executes, that code then ran in other tenants' isolates and
   * browsers.
   *
   * A name is an identity. This column is what makes it one: `register` refuses a name whose
   * publisher is somebody else.
   *
   * NULL means "published by the platform itself" (the first-party catalogue, seeded or published
   * by an operator holding a platform role). Those are not owned by any tenant and only a platform
   * principal can touch them — which is already true, because publishing at all now requires
   * `platform:extensions:publish`.
   */
  @Index('IDX_plugins_publisher_organization')
  @Column({ name: 'publisher_organization_id', type: 'uuid', nullable: true })
  publisherOrganizationId: string | null;

  @Column({ type: 'enum', enum: PluginStatus, default: PluginStatus.ACTIVE })
  status: PluginStatus;

  @OneToMany(() => PluginVersion, (version) => version.plugin, { cascade: true })
  versions: PluginVersion[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
