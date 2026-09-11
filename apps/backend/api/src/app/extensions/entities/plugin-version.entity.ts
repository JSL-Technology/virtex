import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Plugin } from './plugin.entity';

export enum PluginChannel {
  STABLE = 'STABLE',
  BETA = 'BETA',
  CANARY = 'CANARY',
}

/**
 * An immutable, signed release of an extension.
 *
 * The `code` is the exact source the sandbox will run, and `signature` is the admission
 * pipeline's attestation over that source — the sandbox refuses to execute code whose signature
 * does not verify, so a row here that was tampered with after admission simply will not run.
 * `capabilities` is the set of privileged operations (e.g. `egress:http`) the version declares it
 * needs; a tenant must consent to each before execution is allowed.
 */
@Entity({ name: 'plugin_versions' })
@Index(['plugin', 'version'], { unique: true })
export class PluginVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Plugin, (plugin) => plugin.versions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pluginId' })
  plugin: Plugin;

  @Column()
  pluginId: string;

  @Column({ length: 50 })
  version: string;

  @Column({ type: 'text' })
  code: string;

  @Column({ type: 'simple-array', nullable: true })
  capabilities: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  sbom: unknown;

  @Column({ type: 'text', nullable: true })
  signature: string | null;

  /**
   * The client-side UI of the extension: JavaScript that runs in a sandboxed iframe in the browser
   * and renders into a `#root` element, talking to the app only through the host bridge
   * (`window.virtex`). Distinct from `code` (which runs server-side in the isolate) — this never
   * runs on the server. Null for a headless, server-only extension.
   */
  @Column({ type: 'text', nullable: true })
  uiEntry: string | null;

  /**
   * Where this version contributes UI, e.g. `{ "points": [{ "type": "page", "title": "Sales heatmap" }] }`.
   * The client extension host reads this to decide where to mount the extension.
   */
  @Column({ type: 'jsonb', nullable: true })
  contributes: unknown;

  @Column({ type: 'enum', enum: PluginChannel, default: PluginChannel.STABLE })
  channel: PluginChannel;

  @CreateDateColumn()
  createdAt: Date;
}
