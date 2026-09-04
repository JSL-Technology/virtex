
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, Between, DataSource } from 'typeorm';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { GeneralLedgerReportDto } from '../journal-entries/dto/general-ledger-report.dto';
import { JournalReportDto } from '../journal-entries/dto/journal-report.dto';
import { JournalEntryStatus } from '../journal-entries/entities/journal-entry.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { CustomerPaymentLine } from '../customers/entities/customer-payment-line.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { JournalEntry } from '../journal-entries/entities/journal-entry.entity';
import { LedgersService } from '../accounting/ledgers.service';
import { toIsoDate, type IsoDate } from '../common/dates';
import { roundAmount } from '../common/money';

export interface JournalReportLine {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: Record<string, string> | string;
  description: string | null;
  debit: number;
  credit: number;
  dimensions: Record<string, string> | null;
}

export interface JournalReportEntry {
  id: string;
  entryNumber: string | null;
  date: IsoDate;
  description: string;
  journalCode: string | null;
  journalName: string | null;
  status: string;
  entryType: string;
  lines: JournalReportLine[];
}

export interface JournalReport {
  ledger: { id: string; name: string; currency: string };
  period: { startDate: IsoDate; endDate: IsoDate };
  entries: JournalReportEntry[];
  page: number;
  pageSize: number;
  totalEntries: number;
  hasMore: boolean;
  totalDebit: number;
  totalCredit: number;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(JournalEntryLine)
    private readonly journalEntryLineRepository: Repository<JournalEntryLine>,
    @InjectRepository(JournalEntry)
    private readonly journalEntryRepository: Repository<JournalEntry>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(Ledger)
    private readonly ledgerRepository: Repository<Ledger>,
    private readonly ledgersService: LedgersService,
    private readonly dataSource: DataSource,
  ) {}

  async getAgingReport(organizationId: string, ledgerId?: string): Promise<any> {
    const today = new Date();
    const ledgerRepo = this.dataSource.getRepository(Ledger);
    let targetLedger: Ledger | null;

    if (ledgerId) {
      targetLedger = await ledgerRepo.findOneBy({ id: ledgerId, organizationId });
      if (!targetLedger) {
        throw new NotFoundError('REPORTS.LIBRO_CONTABLE_ID_NO_ENCONTRADO', { ledgerId });
      }
    } else {
      targetLedger = await ledgerRepo.findOneBy({ organizationId, isDefault: true });
    }

    if (!targetLedger) {
        throw new BadRequestError('REPORTS.NO_PUDO_DETERMINAR_LIBRO_CONTABLE_REPORTE_NO');
    }

    const settings = await this.dataSource.getRepository(OrganizationSettings).findOneBy({ organizationId });
    if (!settings || !settings.defaultAccountsReceivableId) {
        throw new BadRequestError('REPORTS.CUENTA_CUENTAS_COBRAR_DEFECTO_NO_ESTA_CONFIGURADA');
    }
    const arAccountId = settings.defaultAccountsReceivableId;

    const openInvoices = await this.invoiceRepository.find({
      where: {
        organizationId,
        status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID]),
      },
      relations: ['customer'],
    });

    if (openInvoices.length === 0) {
        return { messageKey: 'REPORTS.NO_HAY_FACTURAS_PENDIENTES_PAGO_PARA_GENERAR_REPORTE' };
    }

    const paymentLines = await this.dataSource.getRepository(CustomerPaymentLine)
        .createQueryBuilder('line')
        .innerJoin('line.payment', 'payment')
        .innerJoin('payment.journalEntry', 'je')
        .innerJoin('je.lines', 'je_line', 'je_line.accountId = :arAccountId', { arAccountId })
        .innerJoin('je_line.valuations', 'valuation')
        .where('line.invoiceId IN (:...invoiceIds)', { invoiceIds: openInvoices.map(i => i.id) })
        .andWhere('valuation.ledgerId = :ledgerId', { ledgerId: targetLedger.id })
        .select(['line.invoiceId as "invoiceId"', 'SUM(valuation.credit) as "paidAmount"'])
        .groupBy('line.invoiceId')
        .getRawMany();

    const paymentsByInvoice = new Map<string, number>(paymentLines.map(p => [p.invoiceId, parseFloat(p.paidAmount)]));

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
      throw new BadRequestError('REPORTS.LIBRO_MAYOR_REQUIERE_AL_MENOS_UNA_CUENTA');
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
          includeUnposted: options.includeDrafts,
          pageSize: 500,
        }),
      ),
    );
  }

  /**
   * The libro diario: entries in date order, each with its lines.
   *
   * ## The filter that was missing
   *
   * There was no `status` predicate at all. Drafts, entries awaiting approval, annulled entries and
   * entries superseded by a modification were all in the daybook — a book that in the Dominican
   * Republic, Mexico, Colombia and Peru is legally required to contain postings and only postings.
   * It also read `ledgerId` as `(options as any).ledgerId`, off the DTO, so the global
   * `ValidationPipe` had already stripped it and the parameter did nothing.
   *
   * ## And the paging
   *
   * It loaded every line in the range, with five `leftJoinAndSelect` relations, and grouped them in
   * memory. A year of a working ledger is millions of rows. Entries are paged now, and the lines of
   * the entries on the page are fetched for those entries only.
   */
  async generateJournalReport(
    organizationId: string,
    options: JournalReportDto,
  ): Promise<JournalReport> {
    const from = toIsoDate(options.startDate);
    const to = toIsoDate(options.endDate);
    if (from > to) throw new BadRequestError('REPORTS.RANGO_FECHAS_INVALIDO');

    const page = Math.max(1, Math.floor(options.page ?? 1));
    const pageSize = Math.min(500, Math.max(1, Math.floor(options.pageSize ?? 100)));

    const ledger = options.ledgerId
      ? await this.ledgerRepository.findOne({
          where: { id: options.ledgerId, organizationId },
        })
      : await this.ledgerRepository.findOne({ where: { organizationId, isDefault: true } });
    if (!ledger) {
      throw new BadRequestError('REPORTS.NO_HAY_LIBRO_CONTABLE_POR_DEFECTO');
    }

    const entryQuery = this.journalEntryRepository
      .createQueryBuilder('entry')
      .innerJoinAndSelect('entry.journal', 'journal')
      .where('entry.organizationId = :organizationId', { organizationId })
      .andWhere('entry.date BETWEEN :from AND :to', { from, to });

    if (!options.includeUnposted) {
      entryQuery.andWhere('entry.status = :posted', { posted: JournalEntryStatus.POSTED });
    }
    if (options.journalIds && options.journalIds.length > 0) {
      entryQuery.andWhere('entry.journalId IN (:...journalIds)', {
        journalIds: options.journalIds,
      });
    }

    const totalEntries = await entryQuery.clone().getCount();

    const entries = await entryQuery
      .orderBy('entry.date', 'ASC')
      // The property path, not the column name. With `skip`/`take` TypeORM builds a distinct-id
      // subquery and resolves each ordering term against the entity metadata; `entry.entry_number`
      // is not a property, so it resolved to `undefined` and every paged daybook request threw
      // `Cannot read properties of undefined (reading 'databaseName')` before returning a row.
      .addOrderBy('entry.entryNumber', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    if (entries.length === 0) {
      return {
        ledger: { id: ledger.id, name: ledger.name, currency: ledger.currency },
        period: { startDate: from, endDate: to },
        entries: [],
        page,
        pageSize,
        totalEntries,
        hasMore: false,
        totalDebit: 0,
        totalCredit: 0,
      };
    }

    const rows = await this.journalEntryLineRepository
      .createQueryBuilder('line')
      .innerJoin('line.journalEntry', 'entry')
      .innerJoin('line.account', 'account')
      .innerJoin('line.valuations', 'valuation')
      .where('entry.id IN (:...entryIds)', { entryIds: entries.map((entry) => entry.id) })
      .andWhere('valuation.ledgerId = :ledgerId', { ledgerId: ledger.id })
      .select([
        'entry.id AS "entryId"',
        'line.id AS id',
        'account.id AS "accountId"',
        'account.name AS "accountName"',
        'line.description AS description',
        'line.dimensions AS dimensions',
        'valuation.debit AS debit',
        'valuation.credit AS credit',
      ])
      .orderBy('line.id', 'ASC')
      .getRawMany<{
        entryId: string;
        id: string;
        accountId: string;
        accountName: Record<string, string>;
        description: string | null;
        dimensions: Record<string, string> | null;
        debit: string;
        credit: string;
      }>();

    // The account code is a `SUM` of segments rather than a column, so it cannot be selected above;
    // one lookup for the accounts on this page rather than a join per line.
    const accountIds = [...new Set(rows.map((row) => row.accountId))];
    const accounts = accountIds.length
      ? await this.accountRepository.find({ where: { id: In(accountIds) } })
      : [];
    const codeById = new Map(accounts.map((account) => [account.id, account.code]));

    const linesByEntry = new Map<string, JournalReportLine[]>();
    let totalDebit = 0;
    let totalCredit = 0;

    for (const row of rows) {
      const debit = Number(row.debit);
      const credit = Number(row.credit);
      totalDebit = roundAmount(totalDebit + debit);
      totalCredit = roundAmount(totalCredit + credit);

      const bucket = linesByEntry.get(row.entryId) ?? [];
      bucket.push({
        id: row.id,
        accountId: row.accountId,
        accountCode: codeById.get(row.accountId) ?? '',
        accountName: row.accountName,
        description: row.description,
        debit,
        credit,
        dimensions: row.dimensions,
      });
      linesByEntry.set(row.entryId, bucket);
    }

    return {
      ledger: { id: ledger.id, name: ledger.name, currency: ledger.currency },
      period: { startDate: from, endDate: to },
      entries: entries.map((entry) => ({
        id: entry.id,
        // The consecutive number, which is what a daybook is indexed by.
        entryNumber: entry.entryNumber,
        date: toIsoDate(entry.date),
        description: entry.description,
        journalCode: entry.journal?.code ?? null,
        journalName: entry.journal?.name ?? null,
        status: entry.status,
        entryType: entry.entryType,
        lines: linesByEntry.get(entry.id) ?? [],
      })),
      page,
      pageSize,
      totalEntries,
      hasMore: page * pageSize < totalEntries,
      totalDebit,
      totalCredit,
    };
  }
}
