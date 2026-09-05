import { Injectable, Logger } from '@nestjs/common';
import { DataSource, Between, In, MoreThan } from 'typeorm';
import { FiscalYear, FiscalYearStatus } from './entities/fiscal-year.entity';
import {
  JournalEntry,
  JournalEntryStatus,
  JournalEntryType,
} from '../journal-entries/entities/journal-entry.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { ResultTransferService } from './result-transfer.service';
import { YearEndCloseDto } from './dto/year-end-close.dto';
import {
  AccountingPeriod,
  PeriodStatus,
} from './entities/accounting-period.entity';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';
import { BadRequestError, ForbiddenError, NotFoundError } from '../i18n/localized.exception';
import { addMonthsIso, monthsBetween, nextDay, previousDay, toIsoDate } from '../common/dates';

/**
 * Closing a fiscal year.
 *
 * ## What this does
 *
 * Three things, in order: every period in the year must already be closed and no document may be
 * left unposted; the year's result is moved to retained earnings with a single closing entry; the
 * year is marked closed and the next one opened.
 *
 * The result transfer belongs **here**, not in the monthly close. It used to run on every period
 * close, which zeroed each month's revenue and expense accounts against retained earnings — and
 * since the income statement sums the movement of those same accounts, the statement of any closed
 * month, and of any range containing one, read zero. The transfer is annual, it happens once, and
 * `ResultTransferService` is the only implementation of it.
 *
 * ## Why there is no opening entry
 *
 * Balance-sheet balances carry themselves: every balance is a `SUM` over the journal and the
 * entries that produced them are still in it. An earlier version posted an entry re-stating every
 * asset, liability and equity account into the new year, which — against a cumulative balance table
 * — doubled the balance sheet at each close. An opening entry only belongs in a system that zeroes
 * its books at year end, and no system that keeps its journal does.
 *
 * ## Fiscal years that are not calendar years
 *
 * The next year runs from the day after this one ends, for as many whole months as the year just
 * closed. The old code hardcoded 31 December, which was wrong for every tenant on an
 * October–September or July–June year — common in both the United States and the region.
 */
@Injectable()
export class YearEndCloseService {
  private readonly logger = new Logger(YearEndCloseService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly auditTrailService: AuditTrailService,
    private readonly resultTransfer: ResultTransferService,
    private readonly journalEntriesService: JournalEntriesService,
  ) {}

  async closeFiscalYear(
    dto: YearEndCloseDto,
    organizationId: string,
    actorUserId: string,
  ): Promise<FiscalYear> {
    return this.dataSource.transaction(async (manager) => {
      const fiscalYear = await manager.findOneBy(FiscalYear, {
        id: dto.fiscalYearId,
        organizationId,
      });
      if (!fiscalYear) throw new NotFoundError('ACCOUNTING.ANO_FISCAL_NO_ENCONTRADO');
      if (fiscalYear.status !== FiscalYearStatus.OPEN) {
        throw new BadRequestError('ACCOUNTING.ANO_FISCAL_NO_ESTA_ABIERTO');
      }

      const periodsInYear = await manager.find(AccountingPeriod, {
        where: {
          organizationId,
          startDate: Between(fiscalYear.startDate, fiscalYear.endDate),
        },
        order: { startDate: 'ASC' },
      });

      if (periodsInYear.length === 0) {
        throw new BadRequestError('ACCOUNTING.ANO_FISCAL_SIN_PERIODOS');
      }

      const openPeriods = periodsInYear.filter(
        (period) => period.status !== PeriodStatus.CLOSED,
      );
      if (openPeriods.length > 0) {
        throw new BadRequestError(
          'ACCOUNTING.NO_PUEDE_CERRAR_ANO_FISCAL_SIGUIENTES_PERIODOS',
          { p1: openPeriods.map((period) => period.name).join(', ') },
        );
      }

      const unpostedCount = await manager.count(JournalEntry, {
        where: {
          organizationId,
          status: In([
            JournalEntryStatus.DRAFT,
            JournalEntryStatus.PENDING_APPROVAL,
          ]),
          date: Between(fiscalYear.startDate, fiscalYear.endDate),
        },
      });
      if (unpostedCount > 0) {
        throw new BadRequestError(
          'ACCOUNTING.EXISTEN_ASIENTOS_BORRADOR_PENDIENTES_APROBACION_DEBEN_SER',
          { draftEntries: unpostedCount },
        );
      }

      // The result transfer, once, for the whole year. It posts into the year's last period, which
      // is closed by now — so the period is reopened for the length of this transaction and shut
      // again below. Posting is refused into a closed period, and that refusal is load-bearing
      // everywhere else; suspending it here, inside the transaction that also re-closes, is
      // narrower than carving an exception into the posting path.
      const lastPeriod = periodsInYear[periodsInYear.length - 1];
      await this.withPeriodTemporarilyOpen(manager, lastPeriod, async () => {
        const entry = await this.resultTransfer.transfer(
          manager,
          organizationId,
          {
            from: fiscalYear.startDate,
            to: fiscalYear.endDate,
            label: `año fiscal ${toIsoDate(fiscalYear.startDate)} – ${toIsoDate(fiscalYear.endDate)}`,
          },
          actorUserId,
        );
        fiscalYear.closingJournalEntryId = entry?.id ?? null;
      });

      fiscalYear.status = FiscalYearStatus.CLOSED;
      const closed = await manager.save(fiscalYear);

      await this.openNextFiscalYear(manager, fiscalYear, organizationId);

      await this.auditTrailService.recordWithManager(manager, {
        userId: actorUserId,
        organizationId,
        entity: 'fiscal_years',
        entityId: fiscalYear.id,
        actionType: ActionType.UPDATE,
        newValue: {
          status: FiscalYearStatus.CLOSED,
          event: 'fiscal-year-closed',
          periodsClosed: periodsInYear.length,
          closingJournalEntryId: fiscalYear.closingJournalEntryId,
        },
        previousValue: { status: FiscalYearStatus.OPEN },
      });

      this.logger.log(
        `Año fiscal ${toIsoDate(fiscalYear.startDate)} – ${toIsoDate(fiscalYear.endDate)} cerrado.`,
      );
      return closed;
    });
  }

  /**
   * Reopen a settled fiscal year: reverse the transfer, and let its periods be reopened again.
   *
   * There was no way to do this. A year, once closed, was permanent — and an audit adjustment
   * arriving after the close is not an exotic case, it is the ordinary reason a year is reopened.
   *
   * The reversal is a posting, so it needs the last period momentarily open, exactly as the close
   * did. The year's periods stay closed afterwards: reopening the year makes them reopenable, it
   * does not reopen them, because the accountant chooses which month the adjustment belongs in.
   */
  async reopenFiscalYear(
    dto: { fiscalYearId: string; reason: string },
    organizationId: string,
    actorUserId: string,
  ): Promise<FiscalYear> {
    return this.dataSource.transaction(async (manager) => {
      const fiscalYear = await manager.findOneBy(FiscalYear, {
        id: dto.fiscalYearId,
        organizationId,
      });
      if (!fiscalYear) throw new NotFoundError('ACCOUNTING.ANO_FISCAL_NO_ENCONTRADO');
      if (fiscalYear.status === FiscalYearStatus.OPEN) {
        throw new BadRequestError('ACCOUNTING.ANO_FISCAL_YA_ESTA_ABIERTO');
      }
      if (fiscalYear.status === FiscalYearStatus.LOCKED) {
        throw new BadRequestError('ACCOUNTING.ANO_FISCAL_ARCHIVADO_NO_SE_PUEDE_REABRIR');
      }

      // A later year cannot already be settled: reopening 2025 while 2026 is closed would leave
      // 2026's opening equity resting on a result that is about to change.
      const laterClosed = await manager.findOne(FiscalYear, {
        where: {
          organizationId,
          status: In([FiscalYearStatus.CLOSED, FiscalYearStatus.LOCKED]),
          startDate: MoreThan(fiscalYear.endDate),
        },
        order: { startDate: 'ASC' },
      });
      if (laterClosed) {
        throw new ForbiddenError('ACCOUNTING.NO_PUEDE_REABRIR_ANO_FISCAL_POSTERIOR_CERRADO', {
          from: toIsoDate(laterClosed.startDate),
        });
      }

      const periodsInYear = await manager.find(AccountingPeriod, {
        where: {
          organizationId,
          startDate: Between(fiscalYear.startDate, fiscalYear.endDate),
        },
        order: { startDate: 'ASC' },
      });

      const closingEntries = await manager.find(JournalEntry, {
        where: {
          organizationId,
          entryType: JournalEntryType.CLOSING_ENTRY,
          status: JournalEntryStatus.POSTED,
          isReversed: false,
          date: Between(fiscalYear.startDate, fiscalYear.endDate),
        },
      });

      if (closingEntries.length > 0 && periodsInYear.length > 0) {
        const lastPeriod = periodsInYear[periodsInYear.length - 1];
        await this.withPeriodTemporarilyOpen(manager, lastPeriod, async () => {
          for (const closingEntry of closingEntries) {
            const reversal = await this.journalEntriesService.createSystemReversal(
              closingEntry.id,
              organizationId,
              {
                reversalDate: toIsoDate(fiscalYear.endDate),
                reason: `Reapertura de año fiscal: ${dto.reason}`,
              },
              manager,
              { actorUserId, systemReason: 'fiscal-year-reopen' },
            );
            this.logger.log(
              `Asiento de cierre anual ${closingEntry.entryNumber} revertido por ${reversal.entryNumber}.`,
            );
          }
        });
      }

      fiscalYear.status = FiscalYearStatus.OPEN;
      fiscalYear.closingJournalEntryId = null;
      const reopened = await manager.save(fiscalYear);

      await this.auditTrailService.recordWithManager(manager, {
        userId: actorUserId,
        organizationId,
        entity: 'fiscal_years',
        entityId: fiscalYear.id,
        actionType: ActionType.UPDATE,
        newValue: {
          status: FiscalYearStatus.OPEN,
          event: 'fiscal-year-reopened',
          reason: dto.reason,
          reversedEntries: closingEntries.length,
        },
        previousValue: { status: FiscalYearStatus.CLOSED },
      });

      this.logger.log(
        `Año fiscal ${toIsoDate(fiscalYear.startDate)} – ${toIsoDate(fiscalYear.endDate)} reabierto. Razón: ${dto.reason}`,
      );
      return reopened;
    });
  }

  /**
   * Run `work` with a period's locks lifted, then put them back exactly as they were.
   *
   * The annual entry and its reversal are both dated in the year's last period, which is closed —
   * and a posting into a closed period is refused, correctly, by the one check every posting path
   * shares. Rather than adding a bypass flag to that check, which would then exist for anything to
   * use, the close lifts the lock for the two statements that need it, inside its own transaction.
   * A rollback restores the period along with everything else.
   */
  private async withPeriodTemporarilyOpen(
    manager: import('typeorm').EntityManager,
    period: AccountingPeriod,
    work: () => Promise<void>,
  ): Promise<void> {
    const previous = {
      status: period.status,
      generalLedgerStatus: period.generalLedgerStatus,
      accountsPayableStatus: period.accountsPayableStatus,
      accountsReceivableStatus: period.accountsReceivableStatus,
      inventoryStatus: period.inventoryStatus,
    };

    await manager.update(
      AccountingPeriod,
      { id: period.id },
      {
        status: PeriodStatus.OPEN,
        generalLedgerStatus: PeriodStatus.OPEN,
        accountsPayableStatus: PeriodStatus.OPEN,
        accountsReceivableStatus: PeriodStatus.OPEN,
        inventoryStatus: PeriodStatus.OPEN,
      },
    );
    try {
      await work();
    } finally {
      await manager.update(AccountingPeriod, { id: period.id }, previous);
    }
  }

  /**
   * Open the year that follows, keeping the tenant's own year length.
   *
   * Idempotent: if the next year already exists — because someone created the calendar in advance,
   * which is the normal way to run this — it is left alone rather than duplicated.
   */
  private async openNextFiscalYear(
    manager: import('typeorm').EntityManager,
    closedYear: FiscalYear,
    organizationId: string,
  ): Promise<void> {
    const nextStart = nextDay(closedYear.endDate);

    // Same length as the year just closed, measured in whole months, so a 12-month year starting in
    // October produces the next October–September year rather than a calendar one.
    const monthSpan = monthsBetween(closedYear.startDate, closedYear.endDate) + 1;
    const nextEnd = previousDay(addMonthsIso(nextStart, monthSpan));

    const existing = await manager.findOneBy(FiscalYear, {
      organizationId,
      startDate: nextStart as unknown as Date,
    });
    if (existing) {
      this.logger.log('El siguiente año fiscal ya existe; no se crea de nuevo.');
      return;
    }

    await manager.save(
      manager.create(FiscalYear, {
        organizationId,
        startDate: nextStart as unknown as Date,
        endDate: nextEnd as unknown as Date,
        status: FiscalYearStatus.OPEN,
      }),
    );
    this.logger.log(`Año fiscal siguiente abierto: ${nextStart} – ${nextEnd}.`);
  }
}
