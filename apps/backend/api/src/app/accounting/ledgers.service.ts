
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Ledger } from './entities/ledger.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { JournalEntryStatus } from '../journal-entries/entities/journal-entry.entity';
import { GeneralLedger, GeneralLedgerLine } from '../core/models/general-ledger.model';
import { AccountNature } from '../chart-of-accounts/enums/account-enums';
import { AccountBalancesService } from '../chart-of-accounts/account-balances.service';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { CreateLedgerDto, UpdateLedgerDto } from './dto/ledger.dto';
import { previousDay, toIsoDate } from '../common/dates';
import { roundAmount } from '../common/money';

@Injectable()
export class LedgersService {
  constructor(
    @InjectRepository(Ledger)
    private readonly ledgerRepository: Repository<Ledger>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(JournalEntryLine)
    private readonly journalEntryLineRepository: Repository<JournalEntryLine>,
    private readonly balances: AccountBalancesService,
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
      throw new BadRequestError('ACCOUNTING.RANGO_FECHAS_INVALIDO');
    }

    const account = await this.accountRepository.findOne({
      where: { id: query.accountId, organizationId },
    });
    if (!account) {
      throw new NotFoundError('ACCOUNTING.CUENTA_ID_NO_ENCONTRADA', {
        accountId: query.accountId,
      });
    }

    const ledger = query.ledgerId
      ? await this.ledgerRepository.findOne({ where: { id: query.ledgerId, organizationId } })
      : await this.ledgerRepository.findOne({ where: { organizationId, isDefault: true } });
    if (!ledger) {
      throw new BadRequestError('ACCOUNTING.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION');
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

    const base = this.journalEntryLineRepository
      .createQueryBuilder('line')
      .innerJoin('line.journalEntry', 'entry')
      .innerJoin('entry.journal', 'journal')
      .innerJoin('line.valuations', 'valuation')
      .where('entry.organizationId = :organizationId', { organizationId })
      .andWhere('line.accountId = :accountId', { accountId: account.id })
      .andWhere('valuation.ledgerId = :ledgerId', { ledgerId: ledger.id })
      .andWhere('entry.date BETWEEN :from AND :to', { from, to });

    if (!query.includeUnposted) {
      base.andWhere('entry.status = :posted', { posted: JournalEntryStatus.POSTED });
    }

    const totalLines = await base.clone().getCount();

    const rows = await base
      .select([
        'line.id AS id',
        'entry.id AS "journalEntryId"',
        'entry.entry_number AS reference',
        'entry.date AS date',
        'entry.description AS "entryDescription"',
        'journal.code AS "journalCode"',
        'line.description AS "lineDescription"',
        'valuation.debit AS debit',
        'valuation.credit AS credit',
      ])
      // `entry_number` after date, so two entries on the same day read in the order the book
      // assigned them rather than in whatever order the planner returns.
      .orderBy('entry.date', 'ASC')
      .addOrderBy('entry.entry_number', 'ASC')
      .addOrderBy('line.id', 'ASC')
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getRawMany<{
        id: string;
        journalEntryId: string;
        reference: string | null;
        date: Date | string;
        entryDescription: string;
        journalCode: string | null;
        lineDescription: string | null;
        debit: string;
        credit: string;
      }>();

    // Paging and a running balance have to agree: page 2 opens where page 1 ended, so the balance
    // brought forward is the opening balance plus everything on the pages before this one.
    const carried =
      page === 1
        ? 0
        : await this.movementBefore(base, page, pageSize);

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

  /** Signed movement on the pages before this one, so a paged running balance stays continuous. */
  private async movementBefore(
    base: SelectQueryBuilder<JournalEntryLine>,
    page: number,
    pageSize: number,
  ): Promise<number> {
    const rows = await base
      .clone()
      .select('COALESCE(SUM(valuation.debit - valuation.credit), 0)', 'movement')
      .orderBy('entry.date', 'ASC')
      .addOrderBy('entry.entry_number', 'ASC')
      .addOrderBy('line.id', 'ASC')
      .limit((page - 1) * pageSize)
      .getRawOne<{ movement: string }>();
    return Number(rows?.movement ?? 0);
  }

  findAll(organizationId: string): Promise<Ledger[]> {
    return this.ledgerRepository.find({ where: { organizationId } });
  }

  async findOne(id: string, organizationId: string): Promise<Ledger> {
    const ledger = await this.ledgerRepository.findOne({ where: { id, organizationId } });
    if (!ledger) {
      throw new NotFoundError('ACCOUNTING.LIBRO_CONTABLE_ID_NO_ENCONTRADO', { id });
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
      throw new BadRequestError('ACCOUNTING.LIBRO_DEFECTO_NO_PUEDE_QUEDAR_SIN_ASIGNAR');
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