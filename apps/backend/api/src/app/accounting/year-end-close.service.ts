import { Injectable, Logger } from '@nestjs/common';
import { DataSource, Between, In } from 'typeorm';
import { FiscalYear, FiscalYearStatus } from './entities/fiscal-year.entity';
import {
  JournalEntry,
  JournalEntryStatus,
} from '../journal-entries/entities/journal-entry.entity';
import { YearEndCloseDto } from './dto/year-end-close.dto';
import {
  AccountingPeriod,
  PeriodStatus,
} from './entities/accounting-period.entity';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { toIsoDate } from '../chart-of-accounts/account-balances.service';

/**
 * Closing a fiscal year.
 *
 * ## Why this is now so short
 *
 * It used to be a second, independent closing engine: it read cumulative account balances, built
 * its own closing entry with the signs inverted (debiting expense accounts that already held debit
 * balances), computed the result as `−(revenue + expenses)`, and then posted an opening entry
 * re-stating every balance-sheet account into the new year. The closing entry was out of balance by
 * twice the expense total and was rejected by the posting service, so the annual close could not
 * complete for any tenant that had expenses; had it completed, the opening entry would have doubled
 * the balance sheet.
 *
 * A fiscal year is its periods. Closing the year is therefore: every period in it must already be
 * closed — which is what moved the result to retained earnings, one period at a time, through the
 * single closing implementation in `PeriodClosingService` — and then the year itself is marked
 * closed and the next one opened. There is no separate closing entry and no opening entry, because
 * balances live in the journal and carry themselves.
 *
 * ## Fiscal years that are not calendar years
 *
 * The next year runs from the day after this one ends to the day before the same date twelve months
 * on. The old code hardcoded 31 December, which was wrong for every tenant on an
 * October–September or July–June year — common in both the United States and the region.
 */
@Injectable()
export class YearEndCloseService {
  private readonly logger = new Logger(YearEndCloseService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly auditTrailService: AuditTrailService,
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
    const endDate = new Date(`${toIsoDate(closedYear.endDate)}T00:00:00.000Z`);
    const startDate = new Date(`${toIsoDate(closedYear.startDate)}T00:00:00.000Z`);

    const nextStart = new Date(endDate);
    nextStart.setUTCDate(nextStart.getUTCDate() + 1);

    // Same length as the year just closed, measured in months, so a 12-month year starting in
    // October produces the next October–September year rather than a calendar one.
    const monthSpan =
      (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
      (endDate.getUTCMonth() - startDate.getUTCMonth()) +
      1;
    const nextEnd = new Date(nextStart);
    nextEnd.setUTCMonth(nextEnd.getUTCMonth() + monthSpan);
    nextEnd.setUTCDate(nextEnd.getUTCDate() - 1);

    const existing = await manager.findOneBy(FiscalYear, {
      organizationId,
      startDate: nextStart.toISOString().slice(0, 10) as unknown as Date,
    });
    if (existing) {
      this.logger.log('El siguiente año fiscal ya existe; no se crea de nuevo.');
      return;
    }

    await manager.save(
      manager.create(FiscalYear, {
        organizationId,
        startDate: nextStart.toISOString().slice(0, 10) as unknown as Date,
        endDate: nextEnd.toISOString().slice(0, 10) as unknown as Date,
        status: FiscalYearStatus.OPEN,
      }),
    );
    this.logger.log(
      `Año fiscal siguiente abierto: ${nextStart.toISOString().slice(0, 10)} – ${nextEnd.toISOString().slice(0, 10)}.`,
    );
  }
}
