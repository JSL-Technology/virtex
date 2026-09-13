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

  @Column({ type: 'enum', enum: PluginStatus, default: PluginStatus.ACTIVE })
  status: PluginStatus;

  @OneToMany(() => PluginVersion, (version) => version.plugin, { cascade: true })
  versions: PluginVersion[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
