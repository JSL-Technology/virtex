
import { Injectable } from '@nestjs/common';
import {
  GeneralLedgerReportDto,
  MAX_LEDGER_REPORT_ACCOUNTS,
  MAX_LEDGER_REPORT_DAYS,
} from '../journal-entries/dto/general-ledger-report.dto';
import { JournalReportDto } from '../journal-entries/dto/journal-report.dto';
import { CustomerPaymentsService } from '../customers/customer-payments.service';
import type { AgingReport } from '../shared/statements/aging-report';
import type { AgingReportDto } from './dto/aging-report.dto';
import { BadRequestError } from '../i18n/localized.exception';
import {
  LedgersService,
  JournalReport,
  JournalReportLine,
  JournalReportEntry,
} from '../accounting/ledgers.service';
import { daysBetween, toIsoDate } from '../common/dates';

// Re-export the canonical types so consumers that already import from here keep compiling.
export type { JournalReport, JournalReportLine, JournalReportEntry };

@Injectable()
export class ReportsService {
  constructor(
    private readonly ledgersService: LedgersService,
    private readonly customerPayments: CustomerPaymentsService,
  ) {}

  /**
   * The receivables ageing, delegated.
   *
   * This module had its own ageing — by ledger, in four fixed buckets — and it answered 500 whenever
   * a tenant had an open invoice: it joined a `payment.journalEntry` relation the payment entity does
   * not have (IA-B02). The screen had long used the receivables module's report, which ages each
   * document at the closing rate of the cut-off and respects the reader's branches. One ageing is
   * the right number; this is the report builder's entry point to it.
   */
  receivablesAging(organizationId: string, options: AgingReportDto, actorUserId: string): Promise<AgingReport> {
    return this.customerPayments.aging(organizationId, options.asOfDate ?? new Date(), {
      branchId: options.branchId,
      actorUserId,
    });
  }

  /**
   * The libro mayor, delegated.
   *
   * There were two implementations of this report with different semantics — this one and
   * `LedgersService.getGeneralLedger` — and only one of them filtered `status = POSTED`. Two
   * implementations of a legal book is one too many; `LedgersService` is the one, and this stays as
   * the entry point the report builder already calls.
   */
  async generateGeneralLedgerReport(
    organizationId: string,
    options: GeneralLedgerReportDto,
  ): Promise<unknown> {
    const accountIds = options.accountIds ?? [];
    if (accountIds.length === 0) {
      throw new BadRequestError('reports.general_ledger_needs_least_one_account');
    }
    if (accountIds.length > MAX_LEDGER_REPORT_ACCOUNTS) {
      throw new BadRequestError('reports.count_accounts_requested_maximum_per_report', {
        count: accountIds.length,
        max: MAX_LEDGER_REPORT_ACCOUNTS,
      });
    }

    // A bound on the window as well as on the account count. Each account is three queries against
    // the journal; a request spanning a century over fifty accounts is a denial of service anyone
    // with a token could perform by accident.
    const from = toIsoDate(options.startDate);
    const to = toIsoDate(options.endDate);
    if (from > to) throw new BadRequestError('reports.start_date_cannot_later_than_end');
    if (daysBetween(from, to) > MAX_LEDGER_REPORT_DAYS) {
      throw new BadRequestError('reports.requested_range_spans_days_days_maximum', {
        days: daysBetween(from, to),
        max: MAX_LEDGER_REPORT_DAYS,
      });
    }

    // One ledger card per account, which is how the book is read and printed. The previous version
    // returned a flat list of lines across every account with no opening balance and no running
    // balance, which is a query result rather than a ledger.
    return Promise.all(
      accountIds.map((accountId) =>
        this.ledgersService.getGeneralLedger(organizationId, {
          accountId,
          startDate: options.startDate,
          endDate: options.endDate,
          ledgerId: options.ledgerId,
          includeUnposted: options.includeUnposted,
          pageSize: 500,
        }),
      ),
    );
  }

  /** The libro diario — delegates to LedgersService, which owns this legal book. */
  generateJournalReport(
    organizationId: string,
    options: JournalReportDto,
  ): Promise<JournalReport> {
    return this.ledgersService.generateJournalReport(organizationId, options);
  }
}
