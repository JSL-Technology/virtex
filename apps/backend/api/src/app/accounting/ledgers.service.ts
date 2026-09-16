
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Ledger } from './entities/ledger.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { GeneralLedger, GeneralLedgerLine } from '../core/models/general-ledger.model';
import { AccountNature } from '../chart-of-accounts/enums/account-enums';
import { AccountBalancesService } from '../chart-of-accounts/account-balances.service';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { CreateLedgerDto, UpdateLedgerDto } from './dto/ledger.dto';
import { previousDay, toIsoDate, type IsoDate } from '../common/dates';
import { roundAmount } from '../common/money';
import { JournalReportDto } from '../journal-entries/dto/journal-report.dto';
import { JournalQueryService } from '../journal-entries/services/journal-query.service';

// ── Libro diario types (owned here — they describe legal books, not custom reports) ────────────

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
export class LedgersService {
  constructor(
    @InjectRepository(Ledger)
    private readonly ledgerRepository: Repository<Ledger>,
    private readonly balances: AccountBalancesService,
    private readonly journalQuery: JournalQueryService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * The libro mayor for one account: opening balance, every movement, running balance.
   *
   * ## What was wrong with it
   *
   * Four things, each of which on its own makes the book disagree with the rest of the product.
   *
   * 1. **No `status` filter.** It summed every `journal_entry_line` regardless of status, so
   *    drafts, entries awaiting approval, annulled entries and entries superseded by a
   *    modification were all in the ledger. Every other balance in the product filters
   *    `status = POSTED`, so the general ledger — a book of legal record in the Dominican
   *    Republic, Mexico, Colombia and Peru — was the one report that did not agree with the trial
   *    balance or the balance sheet.
   * 2. **It read `line.debit`/`line.credit`** rather than the per-ledger valuation, so a
   *    multi-GAAP tenant got the default ledger's figures whichever book it asked for. There was
   *    no `ledgerId` parameter to ask with.
   * 3. **It loaded every line of the account since inception into memory**, with no paging.
   * 4. **It printed `JE-` plus eight characters of a uuid** as the reference, years after
   *    consecutive numbering landed.
   *
   * There were also two implementations — this one and `ReportsService.generateGeneralLedgerReport`
   * — with different semantics. That one at least filtered status and used valuations, and its
   * route had no permission at all. Both now go through here.
   *
   * ## The running balance
   *
   * Presented in the account's natural sense: a debit-natured account grows with debits, a
   * credit-natured one with credits. That is what a reader expects of a ledger card, and it is a
   * presentation decision made once, here — `AccountBalancesService` stays signed as
   * `debit − credit` throughout, because a service that flipped its sign by account type would make
   * every caller's arithmetic depend on data.
   */
  async getGeneralLedger(
    organizationId: string,
    query: {
      accountId: string;
      startDate: Date | string;
      endDate: Date | string;
      ledgerId?: string;
      page?: number;
      pageSize?: number;
      /**
       * Include entries that are not posted.
       *
       * Off by default and never on for anything a reader would call the libro mayor: it exists so
       * an accountant reviewing their own drafts before a close can see them, and the response
       * says which it is by way of the caller having asked.
       */
      includeUnposted?: boolean;
    },
  ): Promise<GeneralLedger> {
    const from = toIsoDate(query.startDate);
    const to = toIsoDate(query.endDate);
    if (from > to) {
      throw new BadRequestError('accounting.start_date_cannot_later_than_end');
    }

    const account = await this.dataSource.manager.getRepository(Account).findOne({
      where: { id: query.accountId, organizationId },
    });
    if (!account) {
      throw new NotFoundError('accounting.account_account_id_not_found', {
        accountId: query.accountId,
      });
    }

    const ledger = query.ledgerId
      ? await this.ledgerRepository.findOne({ where: { id: query.ledgerId, organizationId } })
      : await this.ledgerRepository.findOne({ where: { organizationId, isDefault: true } });
    if (!ledger) {
      throw new BadRequestError('accounting.no_default_ledger_has_configured_organization');
    }

    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(500, Math.max(1, Math.floor(query.pageSize ?? 100)));

    // The opening balance is a `SUM` in the database, not a fetch-and-add in JavaScript over every
    // line the account has ever carried.
    const signedOpening = await this.balances.balanceOf(account.id, {
      organizationId,
      ledgerId: ledger.id,
      asOf: previousDay(from),
    });

    const { rows, totalLines } = await this.journalQuery.getGeneralLedgerLines({
      organizationId,
      accountId: account.id,
      ledgerId: ledger.id,
      from,
      to,
      includeUnposted: query.includeUnposted,
      page,
      pageSize,
    });

    // Paging and a running balance have to agree: page 2 opens where page 1 ended, so the balance
    // brought forward is the opening balance plus everything on the pages before this one.
    const carried =
      page === 1
        ? 0
        : await this.journalQuery.getMovementBeforeCurrentPage({
            organizationId,
            accountId: account.id,
            ledgerId: ledger.id,
            from,
            to,
            includeUnposted: query.includeUnposted,
            page,
            pageSize,
          });

    const naturalSign = account.nature === AccountNature.DEBIT ? 1 : -1;
    let running = roundAmount(naturalSign * (signedOpening + carried));

    let periodDebit = 0;
    let periodCredit = 0;

    const lines: GeneralLedgerLine[] = rows.map((row) => {
      const debit = Number(row.debit);
      const credit = Number(row.credit);
      periodDebit = roundAmount(periodDebit + debit);
      periodCredit = roundAmount(periodCredit + credit);
      running = roundAmount(running + naturalSign * (debit - credit));

      return {
        id: row.id,
        journalEntryId: row.journalEntryId,
        date: toIsoDate(row.date),
        reference: row.reference ?? '',
        journalCode: row.journalCode,
        description: row.lineDescription || row.entryDescription,
        debit,
        credit,
        balance: running,
      };
    });

    const signedClosing = await this.balances.balanceOf(account.id, {
      organizationId,
      ledgerId: ledger.id,
      asOf: to,
    });

    return {
      ledger: { id: ledger.id, name: ledger.name, currency: ledger.currency },
      account: {
        id: account.id,
        code: account.code,
        // The whole translation map, not `name['es']`. It used to hand back the Spanish string or
        // the literal 'Nombre no disponible', which pins an English-speaking tenant to Spanish and
        // shows a Spanish apology when even that is missing.
        name: account.name,
        type: account.type,
        nature: account.nature,
      },
      startDate: from,
      endDate: to,
      initialBalance: roundAmount(naturalSign * signedOpening),
      finalBalance: roundAmount(naturalSign * signedClosing),
      periodDebit,
      periodCredit,
      lines,
      page,
      pageSize,
      totalLines,
      hasMore: page * pageSize < totalLines,
    };
  }

  /**
   * The libro diario: entries in date order, each with its lines.
   *
   * Entries are paged; the lines of the entries on each page are fetched in a single second query
   * keyed to those entry ids only. A year of a working ledger is millions of rows, and loading
   * every line in the range is not the same as paging entries.
   */
  async generateJournalReport(
    organizationId: string,
    options: JournalReportDto,
  ): Promise<JournalReport> {
    const from = toIsoDate(options.startDate);
    const to = toIsoDate(options.endDate);
    if (from > to) throw new BadRequestError('reports.start_date_cannot_later_than_end');

    const page = Math.max(1, Math.floor(options.page ?? 1));
    const pageSize = Math.min(500, Math.max(1, Math.floor(options.pageSize ?? 100)));

    const ledger = options.ledgerId
      ? await this.ledgerRepository.findOne({
          where: { id: options.ledgerId, organizationId },
        })
      : await this.ledgerRepository.findOne({ where: { organizationId, isDefault: true } });
    if (!ledger) {
      throw new BadRequestError('reports.no_default_ledger_configured_set_one');
    }

    const { entries, lines: rawLines, totalEntries } = await this.journalQuery.getJournalReportEntries({
      organizationId,
      ledgerId: ledger.id,
      from,
      to,
      includeUnposted: options.includeUnposted,
      journalIds: options.journalIds,
      page,
      pageSize,
    });

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

    const accountIds = [...new Set(rawLines.map((row) => row.accountId))];
    const accounts = accountIds.length
      ? await this.dataSource.manager.getRepository(Account).find({ where: { id: In(accountIds) } })
      : [];
    const codeById = new Map(accounts.map((a) => [a.id, a.code]));

    const linesByEntry = new Map<string, JournalReportLine[]>();
    let totalDebit = 0;
    let totalCredit = 0;

    for (const row of rawLines) {
      totalDebit = roundAmount(totalDebit + row.debit);
      totalCredit = roundAmount(totalCredit + row.credit);

      const bucket = linesByEntry.get(row.entryId) ?? [];
      bucket.push({
        id: row.lineId,
        accountId: row.accountId,
        accountCode: codeById.get(row.accountId) ?? '',
        accountName: row.accountName,
        description: row.description,
        debit: row.debit,
        credit: row.credit,
        dimensions: row.dimensions,
      });
      linesByEntry.set(row.entryId, bucket);
    }

    return {
      ledger: { id: ledger.id, name: ledger.name, currency: ledger.currency },
      period: { startDate: from, endDate: to },
      entries: entries.map((entry) => ({
        id: entry.id,
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

  findAll(organizationId: string): Promise<Ledger[]> {
    return this.ledgerRepository.find({ where: { organizationId } });
  }

  async findOne(id: string, organizationId: string): Promise<Ledger> {
    const ledger = await this.ledgerRepository.findOne({ where: { id, organizationId } });
    if (!ledger) {
      throw new NotFoundError('accounting.ledger_id_not_found', { id });
    }
    return ledger;
  }

  async create(createDto: CreateLedgerDto, organizationId: string): Promise<Ledger> {
    if (createDto.isDefault) {
      await this.ensureNoOtherDefault(organizationId);
    }
    const ledger = this.ledgerRepository.create({
      // Field by field. `{ ...createDto, organizationId }` was safe only because the tenant came
      // last; one reordering away from letting the body choose its own tenant.
      name: createDto.name,
      description: createDto.description,
      currency: createDto.currency.toUpperCase(),
      isDefault: createDto.isDefault ?? false,
      isActive: createDto.isActive ?? true,
      organizationId,
    });
    return this.ledgerRepository.save(ledger);
  }

  /**
   * Update the fields a ledger may have changed.
   *
   * Assignment is explicit. `Object.assign(ledger, updateDto)` over a body the ValidationPipe never
   * inspected — because `Partial<Ledger>` leaves `Object` as the runtime metatype — let a request
   * carrying `organizationId` move the ledger, and the accounting hanging off it, to another
   * tenant. Neither the tenant nor the id is assignable here, whatever the body says.
   */
  async update(
    id: string,
    updateDto: UpdateLedgerDto,
    organizationId: string,
  ): Promise<Ledger> {
    const ledger = await this.findOne(id, organizationId);

    if (updateDto.isDefault && !ledger.isDefault) {
      await this.ensureNoOtherDefault(organizationId);
    }
    if (updateDto.isDefault === false && ledger.isDefault) {
      // A tenant with no default ledger cannot post at all: every posting path resolves the
      // default to value its lines against.
      throw new BadRequestError('accounting.default_ledger_cannot_unset_without_designating');
    }

    if (updateDto.name !== undefined) ledger.name = updateDto.name;
    if (updateDto.description !== undefined) ledger.description = updateDto.description;
    if (updateDto.isDefault !== undefined) ledger.isDefault = updateDto.isDefault;
    if (updateDto.isActive !== undefined) ledger.isActive = updateDto.isActive;

    return this.ledgerRepository.save(ledger);
  }

  private async ensureNoOtherDefault(organizationId: string): Promise<void> {
    await this.ledgerRepository.update({ organizationId, isDefault: true }, { isDefault: false });
  }
}