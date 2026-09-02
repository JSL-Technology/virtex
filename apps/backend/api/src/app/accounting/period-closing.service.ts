import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource, Between, EntityManager, MoreThan } from 'typeorm';
import {
  AccountingPeriod,
  ModuleSlug,
  PeriodStatus,
} from './entities/accounting-period.entity';
import { Account, AccountType } from '../chart-of-accounts/entities/account.entity';
import {
  JournalEntry,
  JournalEntryStatus,
  JournalEntryType,
} from '../journal-entries/entities/journal-entry.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from './entities/ledger.entity';
import { LockAccountInPeriodDto } from './dto/lock-account-period.dto';
import { AccountPeriodLock } from './entities/account-period-lock.entity';
import {
  CreateJournalEntryDto,
  CreateJournalEntryLineDto,
} from '../journal-entries/dto/create-journal-entry.dto';
import { ReopenPeriodDto } from './dto/reopen-period.dto';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';
import { ClosingAutomationService } from './closing-automation.service';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../i18n/localized.exception';
import { LocalizedMessage } from '../i18n/localized-message';
import {
  AccountBalancesService,
  closingSideFor,
  previousDay,
  toIsoDate,
} from '../chart-of-accounts/account-balances.service';
import { moduleStatusColumn } from './period-status';
import { roundAmount, toCents } from '../common/money';

/**
 * Closing and reopening accounting periods.
 *
 * ## What a close does, and what it does not
 *
 * Closing a period does two things: it moves the period's result to retained earnings, and it
 * locks the period against further posting. That is all.
 *
 * It emphatically does **not** carry balance-sheet balances forward with an opening entry. Balances
 * carry forward because the entries that created them are still in the book and every balance is a
 * `SUM` over the book — there is nothing to move. The previous implementation posted an entry that
 * debited or credited every asset, liability and equity account by its own balance at each monthly
 * close; because the balance table was cumulative and had no period dimension, that entry was then
 * added to the balance it was meant to be carrying. Cash of 100,000 read 200,000 after the first
 * close and 300,000 after the second. An opening entry only belongs in a system that zeroes the
 * balance sheet at year end, and no system that keeps its journal does.
 *
 * ## One close, one sign convention
 *
 * There used to be two implementations. The monthly close assigned `debit = balance` for revenue
 * and `credit = balance` for expenses, then dropped every line whose debit and credit were not both
 * positive — and since a revenue balance is negative under `debit − credit`, **every revenue
 * account was silently dropped from every close**. The year-end close inverted the signs the other
 * way and computed the result as `−(revenue + expenses)`, producing an entry out of balance by
 * twice the expense total, which the posting service then rejected: the annual close could not
 * complete at all for any tenant with expenses.
 *
 * Both are gone. `closingSideFor` in `AccountBalancesService` turns a signed balance into the debit
 * and credit that return it to zero, whatever its sign, and this is the only close there is. The
 * year-end close is the close of the year's last period plus the fiscal-year bookkeeping around it.
 */
@Injectable()
export class PeriodClosingService {
  private readonly logger = new Logger(PeriodClosingService.name);

  constructor(
    @InjectRepository(AccountingPeriod)
    private readonly periodRepository: Repository<AccountingPeriod>,
    @InjectRepository(AccountPeriodLock)
    private readonly accountLockRepository: Repository<AccountPeriodLock>,
    private readonly journalEntriesService: JournalEntriesService,
    private readonly balances: AccountBalancesService,
    private readonly dataSource: DataSource,
    private readonly auditTrailService: AuditTrailService,
    private readonly closingAutomationService: ClosingAutomationService,
  ) {}

  /**
   * The tenant's accounting periods, oldest first.
   *
   * The calendar is data, not presentation: the reader's own language decides how "2026-03-01" is
   * spelled, so this returns the dates and the per-module statuses and lets the client render them.
   */
  async listPeriods(
    organizationId: string,
    filters: { year?: number } = {},
  ): Promise<AccountingPeriod[]> {
    const where: Record<string, unknown> = { organizationId };
    if (filters.year !== undefined) {
      where['startDate'] = Between(
        `${filters.year}-01-01` as unknown as Date,
        `${filters.year}-12-31` as unknown as Date,
      );
    }
    return this.periodRepository.find({ where, order: { startDate: 'ASC' } });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Closing
  // ───────────────────────────────────────────────────────────────────────────

  async closePeriod(
    periodId: string,
    organizationId: string,
    actorUserId: string,
  ): Promise<AccountingPeriod> {
    return this.dataSource.transaction(async (manager) => {
      const period = await manager.findOneBy(AccountingPeriod, {
        id: periodId,
        organizationId,
      });
      if (!period) {
        throw new NotFoundError('ACCOUNTING.PERIODO_CONTABLE_ESPECIFICADO_NO_FUE_ENCONTRADO');
      }
      if (period.status === PeriodStatus.CLOSED) {
        throw new BadRequestError('ACCOUNTING.PERIODO_YA_ENCUENTRA_CERRADO');
      }

      // Periods close in order. Closing March while January is still open would compute March's
      // result over a book that is still moving underneath it, and the retained-earnings figure
      // would be wrong the moment January was closed.
      const earlierOpen = await manager.findOne(AccountingPeriod, {
        where: {
          organizationId,
          status: PeriodStatus.OPEN,
          endDate: Between(
            '1900-01-01' as unknown as Date,
            previousDay(period.startDate) as unknown as Date,
          ),
        },
        order: { startDate: 'ASC' },
      });
      if (earlierOpen) {
        throw new BadRequestError('ACCOUNTING.PERIODO_ANTERIOR_SIGUE_ABIERTO', {
          name: earlierOpen.name,
        });
      }

      const unpostedCount = await manager.count(JournalEntry, {
        where: {
          organizationId,
          status: In([
            JournalEntryStatus.DRAFT,
            JournalEntryStatus.PENDING_APPROVAL,
          ]),
          date: Between(period.startDate, period.endDate),
        },
      });
      if (unpostedCount > 0) {
        throw new BadRequestError(
          'ACCOUNTING.NO_PUEDE_CERRAR_PERIODO_EXISTEN_ASIENTOS_CONTABLES',
          { draftEntriesCount: unpostedCount },
        );
      }

      // Depreciation and FX revaluation post into the period being closed. They run *before* the
      // result is computed and, because balances are read from the journal through the same
      // transaction, the closing entry now includes them. Under the old queue-based balances it
      // could not: the figures it read were written by a worker that had not run yet.
      await this.closingAutomationService.runPreClosingTasks(
        period,
        organizationId,
        manager,
      );

      await this.postClosingEntry(manager, period, organizationId, actorUserId);

      period.status = PeriodStatus.CLOSED;
      period.generalLedgerStatus = PeriodStatus.CLOSED;
      period.accountsPayableStatus = PeriodStatus.CLOSED;
      period.accountsReceivableStatus = PeriodStatus.CLOSED;
      period.inventoryStatus = PeriodStatus.CLOSED;
      const closedPeriod = await manager.save(period);

      await this.auditTrailService.recordWithManager(manager, {
        userId: actorUserId,
        organizationId,
        entity: 'accounting_periods',
        entityId: periodId,
        actionType: ActionType.UPDATE,
        newValue: { status: PeriodStatus.CLOSED, event: 'period-closed' },
        previousValue: { status: PeriodStatus.OPEN },
      });

      this.logger.log(`Período ${period.name} cerrado.`);
      return closedPeriod;
    });
  }

  /**
   * The entry that zeroes the period's profit and loss accounts into retained earnings.
   *
   * Every revenue and expense account with a non-zero balance for the period gets the line that
   * cancels it — whichever side that turns out to be, so contra-revenue and expense refunds are
   * handled by the same code as ordinary balances. The retained-earnings line is the arithmetic
   * remainder, computed in cents, so the entry balances by construction rather than by a formula
   * that has to agree with the lines independently.
   */
  private async postClosingEntry(
    manager: EntityManager,
    period: AccountingPeriod,
    organizationId: string,
    actorUserId: string,
  ): Promise<JournalEntry | null> {
    const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
    if (!settings?.defaultRetainedEarningsAccountId) {
      throw new BadRequestError(
        'ACCOUNTING.CUENTA_RESULTADOS_EJERCICIO_GANANCIAS_RETENIDAS_NO_ESTA',
      );
    }

    const closingJournal = await manager.findOneBy(Journal, {
      organizationId,
      code: 'CIERRE',
    });
    if (!closingJournal) {
      throw new BadRequestError('ACCOUNTING.DIARIO_CIERRE_CIERRE_NO_ENCONTRADO_FAVOR_CREE');
    }

    const ledgers = await manager.find(Ledger, { where: { organizationId } });
    const defaultLedger = ledgers.find((ledger) => ledger.isDefault);
    if (!defaultLedger) {
      throw new BadRequestError(
        'ACCOUNTING.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION',
      );
    }

    const resultAccounts = await manager.find(Account, {
      where: {
        organizationId,
        type: In([AccountType.REVENUE, AccountType.EXPENSE]),
      },
    });
    if (resultAccounts.length === 0) return null;

    // The period's own movement, not the account's cumulative balance. Closing the cumulative
    // figure only happens to be right for the very first period ever closed.
    const movements = await this.balances.movements(
      {
        organizationId,
        ledgerId: defaultLedger.id,
        accountIds: resultAccounts.map((account) => account.id),
        from: period.startDate,
        to: period.endDate,
      },
      manager,
    );

    const lines: CreateJournalEntryLineDto[] = [];
    let resultCents = 0;

    for (const movement of movements) {
      const signedBalance = roundAmount(movement.debit - movement.credit);
      if (toCents(signedBalance) === 0) continue;

      const { debit, credit } = closingSideFor(signedBalance);
      lines.push({
        accountId: movement.accountId,
        debit,
        credit,
        description: `Cierre del período ${period.name}`,
        valuations: [{ ledgerId: defaultLedger.id, debit, credit }],
      });
      resultCents += toCents(signedBalance);
    }

    if (lines.length === 0) {
      this.logger.log(`Período ${period.name}: sin resultados que cerrar.`);
      return null;
    }

    // `resultCents` is the sum of the signed P&L balances. Revenue is negative and expense
    // positive, so a profit is a negative sum; the retained-earnings line takes the opposite side
    // of the lines above, which is exactly what `closingSideFor` on the negated total gives.
    const retained = closingSideFor(-roundAmount(resultCents / 100));
    lines.push({
      accountId: settings.defaultRetainedEarningsAccountId,
      debit: retained.debit,
      credit: retained.credit,
      description: `Traspaso de resultado del período ${period.name}`,
      valuations: [
        { ledgerId: defaultLedger.id, debit: retained.debit, credit: retained.credit },
      ],
    });

    const netIncome = roundAmount(-resultCents / 100);
    this.logger.log(
      `Cierre de ${period.name}: ${lines.length - 1} cuentas de resultado, resultado neto ${netIncome}.`,
    );

    const entryDto: CreateJournalEntryDto = {
      date: toIsoDate(period.endDate),
      description: `Asiento de cierre — período ${period.name}`,
      lines,
      journalId: closingJournal.id,
      entryType: JournalEntryType.CLOSING_ENTRY,
    };

    return this.journalEntriesService.createWithManager(
      manager,
      entryDto,
      organizationId,
      { actorUserId, systemReason: 'period-close' },
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Reopening
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Reopen a closed period and reverse the closing entry that shut it.
   *
   * ## Why this could never work before
   *
   * The reversal was posted *before* the period's status was set back to OPEN. Posting resolves the
   * period for the entry's date and refuses a closed one, so the reversal was rejected and the
   * whole reopen rolled back — every time, for any period that had a closing entry, which is every
   * period anyone would want to reopen. The status change now comes first, inside the same
   * transaction, so either both happen or neither does.
   */
  async reopenPeriod(
    dto: ReopenPeriodDto,
    organizationId: string,
    userId: string,
  ): Promise<AccountingPeriod> {
    const { periodId, reason } = dto;

    return this.dataSource.transaction(async (manager) => {
      const period = await manager.findOneBy(AccountingPeriod, {
        id: periodId,
        organizationId,
      });
      if (!period) throw new NotFoundError('ACCOUNTING.PERIODO_REABRIR_NO_ENCONTRADO');
      if (period.status !== PeriodStatus.CLOSED) {
        throw new BadRequestError('ACCOUNTING.PERIODO_NO_ESTA_CERRADO');
      }

      const laterClosed = await manager.findOne(AccountingPeriod, {
        where: {
          organizationId,
          status: PeriodStatus.CLOSED,
          startDate: MoreThan(period.endDate),
        },
        order: { startDate: 'ASC' },
      });
      if (laterClosed) {
        throw new ForbiddenError('ACCOUNTING.NO_PUEDE_REABRIR_ESTE_PERIODO_PORQUE_PERIODO');
      }

      // Open it first. The reversal below is a posting, and a posting into a closed period is
      // refused — which is the whole reason the previous implementation always failed.
      period.status = PeriodStatus.OPEN;
      period.generalLedgerStatus = PeriodStatus.OPEN;
      period.accountsPayableStatus = PeriodStatus.OPEN;
      period.accountsReceivableStatus = PeriodStatus.OPEN;
      period.inventoryStatus = PeriodStatus.OPEN;
      const reopened = await manager.save(period);

      const closingEntries = await manager.find(JournalEntry, {
        where: {
          organizationId,
          entryType: JournalEntryType.CLOSING_ENTRY,
          status: JournalEntryStatus.POSTED,
          isReversed: false,
          date: Between(period.startDate, period.endDate),
        },
      });

      for (const closingEntry of closingEntries) {
        const reversal = await this.journalEntriesService.createSystemReversal(
          closingEntry.id,
          organizationId,
          {
            reversalDate: toIsoDate(period.endDate),
            reason: `Reapertura de período: ${reason}`,
          },
          manager,
          { actorUserId: userId, systemReason: 'period-reopen' },
        );
        reopened.reopeningJournalEntryId = reversal.id;
        this.logger.log(
          `Asiento de cierre ${closingEntry.entryNumber} revertido por ${reversal.entryNumber}.`,
        );
      }
      await manager.save(reopened);

      await this.auditTrailService.recordWithManager(manager, {
        userId,
        organizationId,
        entity: 'accounting_periods',
        entityId: periodId,
        actionType: ActionType.UPDATE,
        newValue: { status: PeriodStatus.OPEN, reason, event: 'period-reopened' },
        previousValue: { status: PeriodStatus.CLOSED },
      });

      this.logger.log(`Período ${period.name} reabierto.`);
      return reopened;
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Per-module close
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Close one subledger's window on a period, leaving the others open.
   *
   * These four statuses existed and were written by these two methods, and nothing anywhere read
   * them: `resolvePostingPeriod` checked only the period's overall status, so closing accounts
   * payable for March did not stop a March supplier invoice. Every posting path now names the
   * subledger it posts on behalf of and both statuses are enforced.
   */
  async closeModulePeriod(
    periodId: string,
    module: ModuleSlug,
    organizationId: string,
    actorUserId: string,
  ): Promise<AccountingPeriod> {
    return this.setModuleStatus(
      periodId,
      module,
      organizationId,
      PeriodStatus.CLOSED,
      actorUserId,
    );
  }

  async reopenModulePeriod(
    periodId: string,
    module: ModuleSlug,
    organizationId: string,
    actorUserId: string,
  ): Promise<AccountingPeriod> {
    const period = await this.periodRepository.findOneBy({
      id: periodId,
      organizationId,
    });
    if (!period) throw new NotFoundError('ACCOUNTING.PERIODO_NO_ENCONTRADO');
    if (period.status === PeriodStatus.CLOSED) {
      throw new BadRequestError('ACCOUNTING.NO_PUEDE_REABRIR_MODULO_SI_PERIODO_CONTABLE');
    }
    return this.setModuleStatus(
      periodId,
      module,
      organizationId,
      PeriodStatus.OPEN,
      actorUserId,
    );
  }

  private async setModuleStatus(
    periodId: string,
    module: ModuleSlug,
    organizationId: string,
    status: PeriodStatus,
    actorUserId: string,
  ): Promise<AccountingPeriod> {
    return this.dataSource.transaction(async (manager) => {
      const period = await manager.findOneBy(AccountingPeriod, {
        id: periodId,
        organizationId,
      });
      if (!period) throw new NotFoundError('ACCOUNTING.PERIODO_NO_ENCONTRADO');

      const column = moduleStatusColumn(module);
      const previous = period[column];
      (period[column] as PeriodStatus) = status;
      const saved = await manager.save(period);

      await this.auditTrailService.recordWithManager(manager, {
        userId: actorUserId,
        organizationId,
        entity: 'accounting_periods',
        entityId: periodId,
        actionType: ActionType.UPDATE,
        newValue: { module, status, event: 'module-period-status-changed' },
        previousValue: { module, status: previous },
      });

      return saved;
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Account-level locks
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Lock a single account within a period.
   *
   * Upserted rather than inserted: locking the same account twice used to create a second row, and
   * unlocking then deleted both or neither depending on the filter.
   */
  async lockAccountInPeriod(
    dto: LockAccountInPeriodDto,
    organizationId: string,
  ): Promise<AccountPeriodLock> {
    const existing = await this.accountLockRepository.findOneBy({
      ...dto,
      organizationId,
    });
    if (existing) {
      existing.isLocked = true;
      return this.accountLockRepository.save(existing);
    }
    return this.accountLockRepository.save(
      this.accountLockRepository.create({ ...dto, organizationId, isLocked: true }),
    );
  }

  async unlockAccountInPeriod(
    dto: LockAccountInPeriodDto,
    organizationId: string,
  ): Promise<LocalizedMessage> {
    const result = await this.accountLockRepository.delete({
      ...dto,
      organizationId,
    });
    if (result.affected === 0) {
      throw new NotFoundError('ACCOUNTING.NO_ENCONTRO_BLOQUEO_CUENTA_PERIODO_ESPECIFICADOS');
    }
    return { messageKey: 'ACCOUNTING.ACCOUNT_PERIOD_LOCK_REMOVED' };
  }
}
