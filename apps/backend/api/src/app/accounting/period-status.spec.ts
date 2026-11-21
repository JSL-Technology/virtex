import { EntityManager } from 'typeorm';
import { resolvePostingPeriod } from './period-status';
import { AccountingPeriod, PeriodStatus } from './entities/accounting-period.entity';
import { FiscalYear, FiscalYearStatus } from './entities/fiscal-year.entity';
import * as fiscalCalendar from './provisioning/fiscal-calendar';
import { fiscalDate, organizationTimeZone } from '../shared/fiscal-clock';

/**
 * Which period a posting date lands in, and when a fiscal year opens for it. These run with a mocked
 * manager — the behaviour under test is which lookups happen, which refusal is raised and when the
 * calendar is materialised, not SQL.
 *
 * A posting into a year nobody has opened used to dead-end on «la fecha no pertenece a ningún
 * período»; it opens that year the first time a transaction needs it, never into a sealed book —
 * and never for a date past the company's horizon (FIN-JE-02): a year mistyped by one opened a
 * whole fiscal year.
 */
jest.mock('./provisioning/fiscal-calendar');

const ensureMock = fiscalCalendar.ensureFiscalYearWithPeriods as jest.Mock;
const ORG = 'org-1';
/** The company's today, on the clock the function reads (no country, no zone: the default). */
const today = fiscalDate(organizationTimeZone({ country: null, timezone: null }));
const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

function openPeriod(name = 'Test', endDate = addDays(today, 10)): AccountingPeriod {
  return {
    id: `p-${name}`,
    name,
    endDate,
    status: PeriodStatus.OPEN,
    generalLedgerStatus: PeriodStatus.OPEN,
    accountsPayableStatus: PeriodStatus.OPEN,
    accountsReceivableStatus: PeriodStatus.OPEN,
    inventoryStatus: PeriodStatus.OPEN,
  } as unknown as AccountingPeriod;
}

/**
 * A manager over a scripted calendar: `periods` answers «which period covers this date», in order,
 * for each lookup after the horizon's own (today's period, `current`); `fiscalYear` answers the
 * lookup of the year that covers a date; `days` is the company's horizon setting.
 */
function managerFor(options: {
  days?: number | null;
  current?: AccountingPeriod | null;
  periods?: Array<AccountingPeriod | null>;
  fiscalYear?: { status: FiscalYearStatus } | null;
  reread?: AccountingPeriod;
}) {
  const periods = [...(options.periods ?? [])];
  const query = jest.fn(async (sql: string) =>
    sql.includes('FROM organizations o') ? [{ country: null, timezone: null, days: options.days === undefined ? 31 : options.days }] : [],
  );
  const findOne = jest.fn(async (entity: unknown, { where }: { where: { startDate: { value: string } } }) => {
    if (entity === FiscalYear) return options.fiscalYear ?? null;
    if (entity === AccountingPeriod) {
      if (where.startDate.value === today && options.current !== undefined) return options.current;
      return periods.length ? periods.shift() : null;
    }
    return null;
  });
  const manager = {
    query,
    findOne,
    findOneBy: jest.fn(async () => options.reread ?? null),
  } as unknown as EntityManager;
  return { manager, query, findOne };
}

describe('resolvePostingPeriod', () => {
  beforeEach(() => ensureMock.mockReset());

  it('returns the covering period and creates nothing when one exists', async () => {
    const period = openPeriod('Now');
    const { manager } = managerFor({ current: period, periods: [period], reread: period });

    await expect(resolvePostingPeriod(manager, ORG, addDays(today, 2))).resolves.toBe(period);
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it('holds the period FOR SHARE and decides on the status read after the lock (GL-04)', async () => {
    const before = openPeriod('Now');
    // A close committed while this posting waited for the lock: the re-read sees it.
    const after = { ...before, status: PeriodStatus.CLOSED } as AccountingPeriod;
    const { manager, query } = managerFor({ current: before, periods: [before], reread: after });

    await expect(resolvePostingPeriod(manager, ORG, today)).rejects.toMatchObject({
      messageKey: 'accounting.transaction_date_falls_accounting_period_name',
      status: 409,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FOR SHARE'), [before.id]);
  });

  it('refuses, as unprocessable, a date no period covers when creation was not requested', async () => {
    const { manager } = managerFor({ current: null, periods: [null] });

    await expect(resolvePostingPeriod(manager, ORG, today)).rejects.toMatchObject({
      messageKey: 'accounting.transaction_date_p1_does_not_fall',
      status: 422,
    });
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it('opens the calendar-year fiscal year on demand, within the horizon, and resolves the new period', async () => {
    const date = addDays(today, 60);
    const period = openPeriod('Materialised', date);
    // A company that allows postings a year ahead; nothing covers the date, nor does a fiscal year.
    const { manager } = managerFor({ days: 366, current: null, periods: [null, period], fiscalYear: null, reread: period });

    await expect(resolvePostingPeriod(manager, ORG, date, undefined, { createIfMissing: true })).resolves.toBe(period);
    expect(ensureMock).toHaveBeenCalledWith(manager, ORG, `${date.slice(0, 4)}-01-01`, 12);
  });

  it('refuses a date past the horizon before any year can open for it (FIN-JE-02)', async () => {
    // The default horizon: thirty-one days. A year mistyped by one is far past it.
    const current = openPeriod('Now', addDays(today, 10));
    const { manager } = managerFor({ current });
    const mistyped = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;

    await expect(resolvePostingPeriod(manager, ORG, mistyped, undefined, { createIfMissing: true })).rejects.toMatchObject({
      messageKey: 'accounting.posting_date_beyond_horizon',
      status: 422,
      params: { date: mistyped, limit: addDays(today, 31), days: 31 },
    });
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it('never ends the horizon before the end of the current period: a month-end entry always fits', async () => {
    // No days ahead at all, and the period runs ten more days.
    const current = openPeriod('Now', addDays(today, 10));
    const { manager } = managerFor({ days: 0, current, periods: [current], reread: current });

    await expect(resolvePostingPeriod(manager, ORG, addDays(today, 10))).resolves.toBe(current);
    await expect(resolvePostingPeriod(managerFor({ days: 0, current }).manager, ORG, addDays(today, 11))).rejects.toMatchObject({
      messageKey: 'accounting.posting_date_beyond_horizon',
      params: { limit: addDays(today, 10), days: 0 },
    });
  });

  it('will not open a year outside the sane window even when the horizon would allow it', async () => {
    // A horizon of a year, and a date more than fifteen years back: no calendar conjured for it.
    const { manager } = managerFor({ days: 366, current: null, periods: [null], fiscalYear: null });
    const farBack = `${Number(today.slice(0, 4)) - 20}-03-15`;

    await expect(resolvePostingPeriod(manager, ORG, farBack, undefined, { createIfMissing: true })).rejects.toMatchObject({
      messageKey: 'accounting.transaction_date_p1_does_not_fall',
    });
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it('never reopens a closed or locked fiscal year', async () => {
    const { manager } = managerFor({ current: null, periods: [null], fiscalYear: { status: FiscalYearStatus.CLOSED } });

    await expect(resolvePostingPeriod(manager, ORG, today, undefined, { createIfMissing: true })).rejects.toMatchObject({
      messageKey: 'accounting.transaction_date_p1_does_not_fall',
    });
    expect(ensureMock).not.toHaveBeenCalled();
  });
});
