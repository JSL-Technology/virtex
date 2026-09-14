
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { JournalEntriesService } from './journal-entries.service';
import { CreateReclassificationEntryDto } from './dto/reclassification-entry.dto';
import { JournalEntry, JournalEntryType } from './entities/journal-entry.entity';
import { CreatePeriodEndAdjustmentDto } from './dto/period-end-adjustment.dto';
import { CreateAuditAdjustmentDto } from './dto/audit-adjustment.dto';
import { FiscalYear, FiscalYearStatus } from '../accounting/entities/fiscal-year.entity';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { BadRequestError, InternalServerError, NotFoundError } from '../i18n/localized.exception';
import { CreateJournalEntryLineDto } from './dto/create-journal-entry.dto';
import { Account, AccountType } from '../chart-of-accounts/entities/account.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Journal } from './entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { closingSideFor } from '../chart-of-accounts/account-balances.service';
import { roundAmount, toCents } from '../common/money';
import { toIsoDate } from '../common/dates';
import { LedgerNarrativeService } from './ledger-narrative.service';
import { I18nService } from '../i18n/i18n.service';

@Injectable()
export class AdjustmentsService {
  private readonly logger = new Logger(AdjustmentsService.name);

  constructor(
    private readonly journalEntriesService: JournalEntriesService,
    private readonly dataSource: DataSource,
    /**
     * The narrative on every entry this service posts, in the tenant's books language.
     *
     * Defaulted so a spec that constructs the service directly keeps working; the module provides
     * the real instance. See `LedgerNarrativeService` for why the books language and not the
     * reader's.
     */
    private readonly narrative: LedgerNarrativeService = new LedgerNarrativeService(
      new I18nService(),
    ),
  ) {}

  /**
   * How an account reads inside a narrative: `1105 — Banco Popular`.
   *
   * The reclassification lines used to name the counter-account by the first eight characters of
   * its UUID — `Transferencia a cta. relacionada con 3f8b21a0` — which identifies nothing to the
   * accountant reading the ledger and nothing to the auditor reading it later.
   */
  private async accountLabel(
    manager: EntityManager,
    organizationId: string,
    accountId: string,
  ): Promise<string> {
    const account = await manager.findOne(Account, {
      where: { id: accountId, organizationId },
      select: { id: true, code: true, name: true },
    });
    if (!account) return accountId;
    return `${account.code} — ${account.name}`;
  }

  async createReclassification(
    dto: CreateReclassificationEntryDto,
    organizationId: string,
    actorUserId: string,
  ): Promise<JournalEntry> {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestError('journal_entries.source_destination_accounts_cannot_same');
    }




    const manager = this.dataSource.manager;
    const [fromLabel, toLabel] = await Promise.all([
      this.accountLabel(manager, organizationId, dto.fromAccountId),
      this.accountLabel(manager, organizationId, dto.toAccountId),
    ]);
    const words = await this.narrative.describeAll(manager, organizationId, {
      header: { key: 'ledger.adjustment.reclassification', params: { description: dto.description } },
      out: { key: 'ledger.adjustment.transfer_out', params: { account: toLabel } },
      in: { key: 'ledger.adjustment.transfer_in', params: { account: fromLabel } },
    });

    const entryDto = {
      date: dto.date,
      description: words.header,
      journalId: dto.journalId,
      lines: [
        {
          accountId: dto.fromAccountId,
          credit: dto.amount,
          debit: 0,
          description: words.out,
        },
        {
          accountId: dto.toAccountId,
          debit: dto.amount,
          credit: 0,
          description: words.in,
        },
      ],
    };

    return this.journalEntriesService.create(entryDto, organizationId, {
      actorUserId,
    });
  }

  async createPeriodEndAdjustment(dto: CreatePeriodEndAdjustmentDto, organizationId: string): Promise<{ adjustment: JournalEntry }> {
    return this.dataSource.transaction(async manager => {
        if (!manager.queryRunner) {
            throw new InternalServerError('journal_entries.transaction_query_runner_could_not_obtained');
        }
        

        const createWithManager = (d: CreateJournalEntryDto) => this.journalEntriesService.createWithQueryRunner(
          manager.queryRunner!,
          d,
          organizationId,
        );

        const adjustment = await createWithManager({
            date: dto.date,
            description: await this.narrative.describe(
              manager,
              organizationId,
              'ledger.adjustment.period_end',
              { type: dto.adjustmentType, description: dto.description },
            ),
            journalId: dto.journalId,
            lines: dto.lines,
        });

        if (dto.reversesNextPeriod) {
            adjustment.reversesNextPeriod = true;
            await manager.save(adjustment);
        }
        
        return { adjustment };
    });
  }

  /**
   * An external audit's correction to a year that has already been closed.
   *
   * ## Why this could never run
   *
   * Two independent defects, both fatal.
   *
   * `fiscal_years.end_date` is a `date` column, which the driver returns as a **string** whatever
   * the TypeScript type says. The service called `adjustmentDate.toISOString()` on it, so every
   * single invocation answered 500 with `"2025-12-31".toISOString is not a function`. The same
   * class of bug is documented as fixed in treasury and reconciliation; here it was still live.
   *
   * And the design contradicted itself. The method required a fiscal year that was *not* open, and
   * then posted through `prepare` → `resolvePostingPeriod`, which refused every closed period with
   * no exception for this entry type. Even without the TypeError, the adjustment would have been
   * rejected every time. Audit adjustments — central to a year-end close and to every external
   * audit — did not exist operationally, and nothing tested them.
   *
   * ## What it does now
   *
   * Dates are `YYYY-MM-DD` throughout, via the helper the rest of the product uses. The posting
   * carries `AUDIT_ADJUSTMENT`, which is the one entry type `resolvePostingPeriod` admits into a
   * closed period — never into a locked (archived) year, which is refused above.
   *
   * And an adjustment that touches profit and loss is followed by its own transfer to retained
   * earnings. Without it, a closed year would end with a result its closing entry does not account
   * for: the balance sheet would still balance, but retained earnings would disagree with the
   * income statement of the year it came from, which is the disagreement an auditor is there to
   * remove rather than create.
   */
  async createAuditAdjustment(
    dto: CreateAuditAdjustmentDto,
    organizationId: string,
    /** Null when the proposer's account has since been deleted; the entry is then unattributed. */
    actorUserId: string | null,
    /**
     * Run on the caller's transaction instead of opening one.
     *
     * The approval that admits an adjustment and the posting that results from it belong to the
     * same transaction: if the posting fails, the approval must fail with it. Without this
     * parameter the caller had to open a second transaction from inside its own, which TypeORM
     * turns into a `SAVEPOINT` on a connection that is not in a transaction block — the exact
     * error the auto-approve path produced the first time anybody ran it.
     */
    outerManager?: EntityManager,
  ): Promise<JournalEntry> {
    const { fiscalYearId, ...entryData } = dto;

    const run = async (manager: EntityManager): Promise<JournalEntry> => {
      const fiscalYear = await manager.findOneBy(FiscalYear, {
        id: fiscalYearId,
        organizationId,
      });

      if (!fiscalYear) {
        throw new NotFoundError('journal_entries.fiscal_year_not_found');
      }
      if (fiscalYear.status === FiscalYearStatus.OPEN) {
        throw new BadRequestError(
          'journal_entries.audit_adjustments_can_only_applied_closed',
        );
      }
      if (fiscalYear.status === FiscalYearStatus.LOCKED) {
        throw new BadRequestError('journal_entries.fiscal_year_archived_cannot_changed');
      }

      // A `date` column arrives as a string. `toIsoDate` accepts either and validates what it is
      // given, which is why it exists.
      const adjustmentDate = toIsoDate(fiscalYear.endDate);

      const entry = await this.journalEntriesService.createWithManager(
        manager,
        {
          ...entryData,
          date: adjustmentDate,
          entryType: JournalEntryType.AUDIT_ADJUSTMENT,
          affectsOpeningBalance: true,
        } as CreateJournalEntryDto,
        organizationId,
        { actorUserId, systemReason: 'audit-adjustment' },
      );

      await this.transferAdjustedResult(manager, organizationId, entry, adjustmentDate, actorUserId);

      this.logger.log(
        `Ajuste de auditoría ${entry.entryNumber} contabilizado en el ejercicio cerrado ` +
          `${fiscalYearId} (cierre ${toIsoDate(fiscalYear.endDate)}) con fecha ${adjustmentDate}.`,
      );
      return entry;
    };

    return outerManager ? run(outerManager) : this.dataSource.transaction(run);
  }

  /**
   * Move an audit adjustment's own effect on profit and loss to retained earnings.
   *
   * Only the adjustment's effect: the year's closing entry is already posted and still stands, so
   * re-running the ordinary result transfer would close the whole year a second time. What is
   * outstanding is exactly what this entry just added to the result accounts, and that is what is
   * transferred — in one entry, dated the same day, in the closing journal, so the closed year's
   * books stay internally consistent.
   *
   * Returns without doing anything when the adjustment is purely a balance-sheet reclassification,
   * which needs no transfer.
   */
  private async transferAdjustedResult(
    manager: EntityManager,
    organizationId: string,
    entry: JournalEntry,
    date: string,
    actorUserId: string | null,
  ): Promise<void> {
    const accountIds = [...new Set(entry.lines.map((line) => line.accountId))];
    const resultAccounts = await manager.find(Account, {
      where: {
        id: In(accountIds),
        organizationId,
        type: In([AccountType.REVENUE, AccountType.EXPENSE]),
      },
      select: { id: true },
    });
    if (resultAccounts.length === 0) return;

    const isResult = new Set(resultAccounts.map((account) => account.id));
    let resultCents = 0;
    for (const line of entry.lines) {
      if (!isResult.has(line.accountId)) continue;
      resultCents += toCents(line.debit) - toCents(line.credit);
    }
    if (resultCents === 0) return;

    const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
    if (!settings?.defaultRetainedEarningsAccountId) {
      throw new BadRequestError(
        'accounting.retained_earnings_account_not_configured_organization',
      );
    }

    const closingJournal = await manager.findOneBy(Journal, { organizationId, code: 'CIERRE' });
    if (!closingJournal) {
      throw new BadRequestError('accounting.closing_journal_cierre_not_found_create');
    }

    const defaultLedger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
    if (!defaultLedger) {
      throw new BadRequestError(
        'accounting.no_default_ledger_has_configured_organization',
      );
    }

    const reference = entry.entryNumber ?? entry.id;
    const words = await this.narrative.describeAll(manager, organizationId, {
      closeLine: { key: 'ledger.adjustment.audit_close_line' },
      resultTransfer: {
        key: 'ledger.adjustment.audit_result_transfer',
        params: { entry: reference },
      },
      closeEntry: { key: 'ledger.adjustment.audit_close_entry', params: { entry: reference } },
    });

    // Each result line is closed by its opposite side, and retained earnings takes the net. In
    // cents, so the entry balances by construction rather than by two formulas agreeing.
    const lines: CreateJournalEntryLineDto[] = [];
    for (const line of entry.lines) {
      if (!isResult.has(line.accountId)) continue;
      const signed = roundAmount(line.debit - line.credit);
      if (toCents(signed) === 0) continue;
      const side = closingSideFor(signed);
      lines.push({
        accountId: line.accountId,
        debit: side.debit,
        credit: side.credit,
        description: words.closeLine,
        valuations: [{ ledgerId: defaultLedger.id, debit: side.debit, credit: side.credit }],
      });
    }

    const retained = closingSideFor(-roundAmount(resultCents / 100));
    lines.push({
      accountId: settings.defaultRetainedEarningsAccountId,
      debit: retained.debit,
      credit: retained.credit,
      description: words.resultTransfer,
      valuations: [{ ledgerId: defaultLedger.id, debit: retained.debit, credit: retained.credit }],
    });

    await this.journalEntriesService.createWithManager(
      manager,
      {
        date,
        description: words.closeEntry,
        journalId: closingJournal.id,
        lines,
        entryType: JournalEntryType.CLOSING_ENTRY,
      } as CreateJournalEntryDto,
      organizationId,
      {
        actorUserId,
        systemReason: 'audit-adjustment-result-transfer',
        // Typed `CLOSING_ENTRY` so every report that excludes closing entries excludes it too,
        // which means it earns no period exemption of its own — this grants it, on the strength of
        // the adjustment it completes.
        allowClosedPeriod: true,
        // One transfer per adjustment, whatever happens to the transaction that posts it.
        idempotencyKey: `audit-adjustment-close:${entry.id}`,
      },
    );
  }
}
