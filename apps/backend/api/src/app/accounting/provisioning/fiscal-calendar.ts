import { EntityManager } from 'typeorm';
import { AccountingPeriod, PeriodStatus } from '../entities/accounting-period.entity';
import { FiscalYear, FiscalYearStatus } from '../entities/fiscal-year.entity';
import { addMonthsIso, previousDay, toIsoDate } from '../../common/dates';

/**
 * Period names as they read in the books. Stored data, not interface text: a period keeps the
 * name it was opened with.
 */
export const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/**
 * A fiscal year and its monthly periods, created together and idempotently.
 *
 * They used to be created apart, each by a different path that forgot the other: provisioning made
 * twelve periods and no fiscal year — so the year-end close had nothing to close for any tenant —
 * and closing a year opened the next fiscal year with no periods in it, so nothing could be posted
 * there. One function makes the pair; whatever already exists is left as it is.
 */
export async function ensureFiscalYearWithPeriods(
  manager: EntityManager,
  organizationId: string,
  start: Date | string,
  months = 12,
): Promise<{ fiscalYear: FiscalYear; periodsCreated: number }> {
  const startIso = toIsoDate(start);
  const endIso = previousDay(addMonthsIso(startIso, months));

  let fiscalYear = await manager.findOneBy(FiscalYear, { organizationId, startDate: startIso as unknown as Date });
  if (!fiscalYear) {
    fiscalYear = await manager.save(
      manager.create(FiscalYear, {
        organizationId,
        startDate: startIso as unknown as Date,
        endDate: endIso as unknown as Date,
        status: FiscalYearStatus.OPEN,
      }),
    );
  }

  const existing = await manager
    .getRepository(AccountingPeriod)
    .createQueryBuilder('p')
    .select('p.startDate', 'start')
    .where('p.organizationId = :organizationId', { organizationId })
    .andWhere('p.startDate >= :from AND p.startDate <= :to', { from: startIso, to: endIso })
    .getRawMany<{ start: string | Date }>();
  const taken = new Set(existing.map((row) => toIsoDate(row.start)));

  const periods: AccountingPeriod[] = [];
  for (let index = 0; index < months; index++) {
    const periodStart = addMonthsIso(startIso, index);
    if (taken.has(periodStart)) continue;
    const periodEnd = previousDay(addMonthsIso(startIso, index + 1));
    const monthIndex = Number(periodStart.slice(5, 7)) - 1;
    periods.push(
      manager.create(AccountingPeriod, {
        organizationId,
        name: `${MONTHS_ES[monthIndex]} ${periodStart.slice(0, 4)}`,
        startDate: periodStart as unknown as Date,
        endDate: periodEnd as unknown as Date,
        status: PeriodStatus.OPEN,
        generalLedgerStatus: PeriodStatus.OPEN,
        accountsPayableStatus: PeriodStatus.OPEN,
        accountsReceivableStatus: PeriodStatus.OPEN,
        inventoryStatus: PeriodStatus.OPEN,
      }),
    );
  }
  if (periods.length > 0) await manager.save(periods);
  return { fiscalYear, periodsCreated: periods.length };
}
