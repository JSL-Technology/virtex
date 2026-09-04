import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  In,
  DataSource,
  Between,
  EntityManager,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
} from 'typeorm';
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
import { FiscalYear, FiscalYearStatus } from './entities/fiscal-year.entity';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../i18n/localized.exception';
import { LocalizedMessage } from '../i18n/localized-message';
import { AccountBalancesService } from '../chart-of-accounts/account-balances.service';
import { moduleStatusColumn } from './period-status';
import { previousDay, toIsoDate } from '../common/dates';

/**
 * Closing and reopening accounting periods.
 *
 * ## What a close does, and what it does not
 *
 * Closing a period does two things: it runs the adjustments that belong to the period —
 * depreciation and foreign-currency revaluation — and it locks the period against further posting.
 * That is all.
 *
 * It does **not** move the result to retained earnings. It used to, on every monthly close, and
 * that single line made the income statement of a closed month read `revenue 0 · expenses 0 ·
 * result 0`: the closing entry debits every revenue account and credits every expense account by
 * its own balance, and the income statement sums the movement of exactly those accounts. The
 * balance sheet still balanced, so nothing looked wrong until someone opened the report the whole
 * module exists to produce. The transfer is an annual act and lives in `ResultTransferService`,
 * called once by `YearEndCloseService`.
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

      // The fiscal year has to still be open. Otherwise a period could be closed after its year
      // was settled, and its movements would sit outside the annual closing entry that was
      // supposed to include them.
      await this.requireOpenFiscalYear(manager, organizationId, period);

      // Depreciation and FX revaluation post into the period being closed, before it is locked.
      // Because balances are read from the journal through this same transaction, everything they
      // post is visible to the year-end result transfer later.
      await this.closingAutomationService.runPreClosingTasks(
        period,
        organizationId,
        manager,
      );

      // Deliberately no closing entry. See `ResultTransferService`: moving the result to retained
      // earnings every month is what made the income statement of a closed month read zero. The
      // transfer happens once, at the fiscal year close.

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
   * The fiscal year a period belongs to must be open before the period can be closed.
   *
   * Without this a period could be closed after its year had been settled, and its movements would
   * sit outside the annual result transfer that was supposed to include them — a permanent gap
   * between the income statement and retained earnings, with nothing to reveal it.
   */
  private async requireOpenFiscalYear(
    manager: EntityManager,
    organizationId: string,
    period: AccountingPeriod,
  ): Promise<void> {
    const year = await manager.findOne(FiscalYear, {
      where: {
        organizationId,
        startDate: LessThanOrEqual(toIsoDate(period.startDate) as unknown as Date),
        endDate: MoreThanOrEqual(toIsoDate(period.endDate) as unknown as Date),
      },
    });
    // No fiscal year on record is not an error: a tenant may run periods without declaring years,
    // and the annual close is what creates the requirement, not the other way round.
    if (year && year.status !== FiscalYearStatus.OPEN) {
      throw new ForbiddenError('ACCOUNTING.ANO_FISCAL_CERRADO_NO_ADMITE_CAMBIOS', {
        from: toIsoDate(year.startDate),
        to: toIsoDate(year.endDate),
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Reopening
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Reopen a closed period, reversing any closing entry dated inside it.
   *
   * ## Why this could never work before
   *
   * The reversal was posted *before* the period's status was set back to OPEN. Posting resolves the
   * period for the entry's date and refuses a closed one, so the reversal was rejected and the
   * whole reopen rolled back — every time, for any period that had a closing entry, which is every
   * period anyone would want to reopen. The status change now comes first, inside the same
   * transaction, so either both happen or neither does.
   *
   * ## The reversal loop is now the exception, not the rule
   *
   * Monthly closes post nothing, so reopening an ordinary month reverses nothing. Only the year's
   * last period carries a closing entry, and that one cannot be reopened from here at all: its
   * fiscal year has to be reopened first, which is what reverses the transfer. The loop stays for
   * periods closed under the old monthly-transfer behaviour, whose entries are still in the book.
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

      // A period inside a settled year is not reopenable on its own: the year's result transfer
      // already consumed its movements. `YearEndCloseService.reopenFiscalYear` undoes that, and
      // only then can the period be touched.
      await this.requireOpenFiscalYear(manager, organizationId, period);

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
