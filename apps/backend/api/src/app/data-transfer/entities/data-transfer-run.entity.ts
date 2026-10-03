import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

export enum DataTransferKind {
  EXPORT = 'EXPORT',
  IMPORT = 'IMPORT',
}

export enum DataTransferStatus {
  /** Every row written (import) or the file produced (export). */
  COMPLETED = 'COMPLETED',
  /** Checked only — `mode=validate` — and nothing was written. */
  VALIDATED = 'VALIDATED',
  /** Refused before writing anything: at least one row did not pass. */
  FAILED = 'FAILED',
  /** Writing stopped part-way (a row passed the checks and was then refused). */
  PARTIAL = 'PARTIAL',
}

/** A row-level problem, in the API's error contract so the client renders it like a form error. */
export interface DataTransferProblem {
  /** Line in the file (the header is line 1). 0 for problems with the file itself. */
  row: number;
  /** Column key, when the problem belongs to one. */
  column?: string;
  key: string;
  params: Record<string, unknown>;
}

/**
 * One export or import, as it happened: who, when, what, how many rows and what went wrong.
 * The «recent exports / imports» lists read this; they used to be a hard-coded array (QA A-10).
 */
@Entity('data_transfer_runs')
@Index('IDX_data_transfer_runs_org_created', ['organizationId', 'createdAt'])
export class DataTransferRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_data_transfer_runs_organization')
  organization?: TenantRef;

  @Column({ type: 'varchar', length: 8 })
  kind: DataTransferKind;

  @Column({ type: 'varchar', length: 64 })
  dataset: string;

  @Column({ type: 'varchar', length: 8 })
  format: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255, nullable: true })
  fileName: string | null;

  @Column({ type: 'varchar', length: 16 })
  status: DataTransferStatus;

  @Column({ name: 'total_rows', type: 'int', default: 0 })
  totalRows: number;

  @Column({ name: 'imported_rows', type: 'int', default: 0 })
  importedRows: number;

  @Column({ name: 'failed_rows', type: 'int', default: 0 })
  failedRows: number;

  /** The first problems found, capped: enough to correct the file, not a copy of it. */
  @Column({ type: 'jsonb', default: [] })
  problems: DataTransferProblem[];

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  /** The author's name as it was: the history stays readable if the user is later removed. */
  @Column({ name: 'user_name', type: 'varchar', length: 255, nullable: true })
  userName: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
