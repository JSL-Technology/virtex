import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

export enum FiscalReportFilingStatus {
  /** Generated at least once; not yet declared as filed. */
  GENERATED = 'GENERATED',
  /** Filed with the authority: the acknowledgement it returned is recorded. */
  SUBMITTED = 'SUBMITTED',
}

/**
 * One periodic fiscal report of one month (606, 607, 608, 609) and where it stands.
 *
 * The files were produced on demand and forgotten: nobody could see which months had been filed,
 * with which acknowledgement, nor whether the data changed after filing — the case that calls for
 * a rectifying return. Every generation records the record count and a hash of the file; after a
 * filing, a generation that produces a different hash says so.
 */
@Entity({ name: 'fiscal_report_filings' })
@Index('UQ_fiscal_report_filings_org_kind_period', ['organizationId', 'kind', 'year', 'month'], { unique: true })
@Check('CHK_fiscal_report_filings_month', `"month" BETWEEN 1 AND 12`)
@Check('CHK_fiscal_report_filings_status', `"status" IN ('GENERATED', 'SUBMITTED')`)
export class FiscalReportFiling {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_fiscal_report_filings_organization')
  organization?: TenantRef;

  /** `606`, `607`, `608`, `609`. */
  @Column({ type: 'varchar', length: 8 })
  kind: string;

  @Column({ type: 'int' })
  year: number;

  @Column({ type: 'int' })
  month: number;

  @Column({ type: 'varchar', length: 16, default: FiscalReportFilingStatus.GENERATED })
  status: FiscalReportFilingStatus;

  @Column({ name: 'record_count', type: 'int', default: 0 })
  recordCount: number;

  /** SHA-256 of the last file generated. */
  @Column({ name: 'last_hash', type: 'varchar', length: 64 })
  lastHash: string;

  @Column({ name: 'last_generated_at', type: 'timestamptz' })
  lastGeneratedAt: Date;

  @Column({ name: 'last_generated_by_user_id', type: 'uuid', nullable: true })
  lastGeneratedByUserId: string | null;

  /** SHA-256 of the file as it was filed. */
  @Column({ name: 'submitted_hash', type: 'varchar', length: 64, nullable: true })
  submittedHash: string | null;

  @Column({ name: 'submitted_record_count', type: 'int', nullable: true })
  submittedRecordCount: number | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ name: 'submitted_by_user_id', type: 'uuid', nullable: true })
  submittedByUserId: string | null;

  /** The authority's acknowledgement (número de acuse / trámite). */
  @Column({ name: 'submission_reference', type: 'varchar', length: 80, nullable: true })
  submissionReference: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
