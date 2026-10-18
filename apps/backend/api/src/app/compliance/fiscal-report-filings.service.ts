import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FiscalReportFiling, FiscalReportFilingStatus } from './entities/fiscal-report-filing.entity';
import { NotFoundError } from '../i18n/localized.exception';

/**
 * The periodic returns whose filing is tracked month by month.
 *
 * The Dominican 606/607/608/609 are monthly obligations, and so are Mexico's Balanza and its
 * Catálogo (filed with the first Balanza and whenever it changes). The Pólizas file is not: the
 * SAT asks for it, for an audit or a refund, and it is answered when asked — tracking it as a
 * monthly filing would show eleven months «not filed» that were never due.
 */
export const TRACKED_FISCAL_REPORTS = ['606', '607', '608', '609', 'catalogo', 'balanza'] as const;
export type TrackedFiscalReport = (typeof TRACKED_FISCAL_REPORTS)[number];

export function isTrackedFiscalReport(kind: string): kind is TrackedFiscalReport {
  return (TRACKED_FISCAL_REPORTS as readonly string[]).includes(kind);
}

/** One month's report as the filing calendar shows it. */
export interface FiscalReportFilingView {
  kind: string;
  year: number;
  month: number;
  status: FiscalReportFilingStatus;
  recordCount: number;
  lastHash: string;
  lastGeneratedAt: string;
  submittedRecordCount: number | null;
  submittedAt: string | null;
  submissionReference: string | null;
  /**
   * Filed, and the data has changed since: the last file generated is not the one that was filed.
   * A rectifying return is what this calls for.
   */
  changedSinceSubmission: boolean;
}

export interface FilingPeriod {
  organizationId: string;
  kind: TrackedFiscalReport;
  year: number;
  month: number;
}

/**
 * Where each month's fiscal report stands: generated, filed, and whether what was filed is still
 * what the books say.
 *
 * Generation is recorded every time a file is produced — a download, or a check from the filing
 * calendar — with the record count and the SHA-256 of the file. Filing is declared by the user
 * with the authority's acknowledgement, and freezes the hash of the file it refers to. A later
 * generation that hashes differently is a change after filing, and the calendar says so.
 */
@Injectable()
export class FiscalReportFilingsService {
  constructor(
    @InjectRepository(FiscalReportFiling)
    private readonly filings: Repository<FiscalReportFiling>,
  ) {}

  /** Record that `body` was generated for the period. Returns the filing as it now stands. */
  async recordGeneration(
    period: FilingPeriod,
    body: string,
    actorUserId: string | null,
  ): Promise<FiscalReportFilingView> {
    await this.filings.upsert(
      {
        organizationId: period.organizationId,
        kind: period.kind,
        year: period.year,
        month: period.month,
        recordCount: countRecords(period.kind, body),
        lastHash: sha256(body),
        lastGeneratedAt: new Date(),
        lastGeneratedByUserId: actorUserId,
      },
      { conflictPaths: ['organizationId', 'kind', 'year', 'month'], skipUpdateIfNoValuesChanged: false },
    );
    return toView(await this.require(period));
  }

  /** Every tracked report of the year, generated or filed, in calendar order. */
  /**
   * The first day the company has anything to report: the earlier of the day it was created and
   * the date of its oldest posted record (journal entry, sales invoice, supplier bill).
   *
   * The calendar used to start every January, so a company created in September was shown eight
   * months of every return as «Overdue» — thirty-two red chips for months in which it did not exist
   * (QA A-15). A month before this date has nothing to file; the calendar says «Not applicable».
   * Records dated before the company existed — an opening balance, history imported from the
   * previous system — move the start back, because those months do have something to report.
   */
  async activeSince(organizationId: string): Promise<string> {
    // As text, so no driver turns the date into a midnight in some other time zone.
    const [row]: Array<{ since: string | null }> = await this.filings.query(
      `SELECT to_char(LEAST(
                (SELECT o."created_at"::date FROM "organizations" o WHERE o."id" = $1),
                (SELECT MIN(j."date")::date FROM "journal_entries" j WHERE j."organization_id" = $1),
                (SELECT MIN(i."issueDate")::date FROM "invoices" i WHERE i."organization_id" = $1),
                (SELECT MIN(b."date")::date FROM "vendor_bills" b WHERE b."organization_id" = $1)
              ), 'YYYY-MM-DD') AS since`,
      [organizationId],
    );
    return row?.since ?? new Date().toISOString().slice(0, 10);
  }

  async list(organizationId: string, year: number): Promise<FiscalReportFilingView[]> {
    const rows = await this.filings.find({
      where: { organizationId, year },
      order: { month: 'ASC', kind: 'ASC' },
    });
    return rows.map(toView);
  }

  /**
   * Declare the period's last generated file as filed, with the authority's acknowledgement.
   *
   * Declaring it again — a rectifying return, filed after the data was corrected — replaces the
   * acknowledgement and the hash: the filing on record is the latest one the authority accepted.
   */
  async markSubmitted(
    period: FilingPeriod,
    reference: string,
    actorUserId: string,
  ): Promise<FiscalReportFilingView> {
    const filing = await this.require(period);
    filing.status = FiscalReportFilingStatus.SUBMITTED;
    filing.submittedHash = filing.lastHash;
    filing.submittedRecordCount = filing.recordCount;
    filing.submittedAt = new Date();
    filing.submittedByUserId = actorUserId;
    filing.submissionReference = reference.trim();
    return toView(await this.filings.save(filing));
  }

  /** Undo a filing declared by mistake. The generation history stays. */
  async clearSubmission(period: FilingPeriod): Promise<FiscalReportFilingView> {
    const filing = await this.require(period);
    filing.status = FiscalReportFilingStatus.GENERATED;
    filing.submittedHash = null;
    filing.submittedRecordCount = null;
    filing.submittedAt = null;
    filing.submittedByUserId = null;
    filing.submissionReference = null;
    return toView(await this.filings.save(filing));
  }

  private async require(period: FilingPeriod): Promise<FiscalReportFiling> {
    const filing = await this.filings.findOne({
      where: {
        organizationId: period.organizationId,
        kind: period.kind,
        year: period.year,
        month: period.month,
      },
    });
    if (!filing) {
      throw new NotFoundError('compliance.fiscal_report_not_generated', {
        kind: period.kind,
        period: `${period.year}-${String(period.month).padStart(2, '0')}`,
      });
    }
    return filing;
  }
}

function sha256(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/**
 * How many records the file declares: the lines after the header of a DGII text format, the
 * accounts of a SAT XML document.
 */
export function countRecords(kind: TrackedFiscalReport, body: string): number {
  switch (kind) {
    case 'catalogo':
      return (body.match(/<catalogocuentas:Ctas\b/g) ?? []).length;
    case 'balanza':
      return (body.match(/<BCE:Ctas\b/g) ?? []).length;
    default:
      return Math.max(0, body.split('\n').filter((line) => line.length > 0).length - 1);
  }
}

function toView(filing: FiscalReportFiling): FiscalReportFilingView {
  return {
    kind: filing.kind,
    year: filing.year,
    month: filing.month,
    status: filing.status,
    recordCount: filing.recordCount,
    lastHash: filing.lastHash,
    lastGeneratedAt: new Date(filing.lastGeneratedAt).toISOString(),
    submittedRecordCount: filing.submittedRecordCount,
    submittedAt: filing.submittedAt ? new Date(filing.submittedAt).toISOString() : null,
    submissionReference: filing.submissionReference,
    changedSinceSubmission:
      filing.status === FiscalReportFilingStatus.SUBMITTED && filing.submittedHash !== filing.lastHash,
  };
}
