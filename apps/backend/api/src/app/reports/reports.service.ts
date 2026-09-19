
import { Injectable } from '@nestjs/common';
import { In, DataSource } from 'typeorm';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import {
  GeneralLedgerReportDto,
  MAX_LEDGER_REPORT_ACCOUNTS,
  MAX_LEDGER_REPORT_DAYS,
} from '../journal-entries/dto/general-ledger-report.dto';
import { JournalReportDto } from '../journal-entries/dto/journal-report.dto';
import { Ledger } from '../accounting/entities/ledger.entity';
import { CustomerPaymentsService } from '../customers/customer-payments.service';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import {
  LedgersService,
  JournalReport,
  JournalReportLine,
  JournalReportEntry,
} from '../accounting/ledgers.service';
import { OrgSettingsService } from '../organizations/services/org-settings.service';
import { daysBetween, toIsoDate } from '../common/dates';

// Re-export the canonical types so consumers that already import from here keep compiling.
export type { JournalReport, JournalReportLine, JournalReportEntry };

@Injectable()
export class ReportsService {
  constructor(
    private readonly ledgersService: LedgersService,
    private readonly orgSettingsService: OrgSettingsService,
    private readonly customerPayments: CustomerPaymentsService,
    private readonly dataSource: DataSource,
  ) {}

  async getAgingReport(organizationId: string, ledgerId?: string): Promise<any> {
    const today = new Date();
    let targetLedger: Ledger | null;

    if (ledgerId) {
      // LedgersService.findOne already throws NotFoundError when the ledger is missing.
      // We rethrow under the reports-specific key so the API response stays backward-compatible.
      try {
        targetLedger = await this.ledgersService.findOne(ledgerId, organizationId);
      } catch {
        throw new NotFoundError('reports.ledger_ledger_id_not_found', { ledgerId });
      }
    } else {
      targetLedger = await this.dataSource.getRepository(Ledger).findOneBy({ organizationId, isDefault: true });
    }

    if (!targetLedger) {
        throw new BadRequestError('reports.ledger_report_could_not_determined_none');
    }

    const settings = await this.orgSettingsService.getForOrg(organizationId);
    if (!settings || !settings.defaultAccountsReceivableId) {
        throw new BadRequestError('reports.default_accounts_receivable_account_not_configured');
    }
    const arAccountId = settings.defaultAccountsReceivableId;

    const openInvoices = await this.dataSource.getRepository(Invoice).find({
      where: {
        organizationId,
        status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID]),
      },
      relations: ['customer'],
    });

    if (openInvoices.length === 0) {
        return { messageKey: 'reports.no_outstanding_invoices_build_report_from' };
    }

    // How much has been collected against each open invoice, valued in this ledger at the AR control
    // account. Owned by the customers module (it owns the receipt→invoice link); read here through
    // its service contract rather than by querying CustomerPaymentLine, which the reports boundary
    // forbids.
    const paymentsByInvoice = await this.customerPayments.paidAmountsByInvoice(
      openInvoices.map((invoice) => invoice.id),
      arAccountId,
      targetLedger.id,
    );

    const report = {
      reportDate: today.toISOString(),
      ledger: { id: targetLedger.id, name: targetLedger.name },
      buckets: {
        '0-30': { amount: 0, count: 0, invoices: [] as any[] },
        '31-60': { amount: 0, count: 0, invoices: [] as any[] },
        '61-90': { amount: 0, count: 0, invoices: [] as any[] },
        '91+': { amount: 0, count: 0, invoices: [] as any[] },
      },
      total: { amount: 0, count: 0 },
    };

    openInvoices.forEach(invoice => {
        const totalInLedger = invoice.totalInBaseCurrency;
        const paidInLedger = paymentsByInvoice.get(invoice.id) || 0;
        const recalculatedBalance = totalInLedger - paidInLedger;

        if (recalculatedBalance <= 0.01) return;

        const dueDate = new Date(invoice.dueDate);
        const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 3600 * 24));
        let bucketKey: keyof typeof report.buckets = '0-30';

        if (daysOverdue > 90) bucketKey = '91+';
        else if (daysOverdue > 60) bucketKey = '61-90';
        else if (daysOverdue > 30) bucketKey = '31-60';
        
        const invoiceData = {
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            customerName: invoice.customer.companyName,
            dueDate: invoice.dueDate,
            balance: recalculatedBalance
        };
        
        const bucket = report.buckets[bucketKey];
        bucket.amount += recalculatedBalance;
        bucket.count++;
        bucket.invoices.push(invoiceData);

        report.total.amount += recalculatedBalance;
        report.total.count++;
    });

    return report;
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
