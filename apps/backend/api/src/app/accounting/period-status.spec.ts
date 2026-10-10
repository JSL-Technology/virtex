import { EntityManager } from 'typeorm';
import { resolvePostingPeriod } from './period-status';
import { PeriodStatus } from './entities/accounting-period.entity';
import { FiscalYearStatus } from './entities/fiscal-year.entity';
import * as fiscalCalendar from './provisioning/fiscal-calendar';

/**
 * The on-demand fiscal-year opener. A posting into a year nobody has opened used to dead-end on
 * "la fecha no pertenece a ningún período"; it now opens that year the first time a transaction
 * needs it, within a sane window, and never into a sealed book. These run with a mocked manager —
 * the behaviour under test is which lookups happen and when the calendar is materialised, not SQL.
 */
jest.mock('./provisioning/fiscal-calendar');

const ensureMock = fiscalCalendar.ensureFiscalYearWithPeriods as jest.Mock;

function openPeriod(name = 'Test') {
  return {
    id: 'p1',
    name,
    status: PeriodStatus.OPEN,
    generalLedgerStatus: PeriodStatus.OPEN,
    accountsPayableStatus: PeriodStatus.OPEN,
    accountsReceivableStatus: PeriodStatus.OPEN,
    inventoryStatus: PeriodStatus.OPEN,
  };
}

describe('resolvePostingPeriod', () => {
  const ORG = 'org-1';
  const thisYear = new Date().getUTCFullYear();

  beforeEach(() => ensureMock.mockReset());

  it('returns the covering period and creates nothing when one exists', async () => {
    const period = openPeriod();
    const manager = { findOne: jest.fn().mockResolvedValue(period) } as unknown as EntityManager;

    await expect(resolvePostingPeriod(manager, ORG, '2026-09-09')).resolves.toBe(period);
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it('refuses when no period covers the date and creation was not requested', async () => {
    const manager = { findOne: jest.fn().mockResolvedValue(null) } as unknown as EntityManager;

    await expect(resolvePostingPeriod(manager, ORG, '2026-09-09')).rejects.toBeDefined();
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it('opens the calendar-year fiscal year on demand and resolves the new period', async () => {
    const period = openPeriod('Materialised');
    const findOne = jest
      .fn()
      .mockResolvedValueOnce(null) // first lookup: nothing covers the date
      .mockResolvedValueOnce(null) // no fiscal year covers it either
      .mockResolvedValueOnce(period); // after opening the year, the period is there
    const manager = { findOne } as unknown as EntityManager;
    const year = thisYear + 1; // next year — inside the window

    await expect(
      resolvePostingPeriod(manager, ORG, `${year}-03-15`, undefined, { createIfMissing: true }),
    ).resolves.toBe(period);
    expect(ensureMock).toHaveBeenCalledWith(manager, ORG, `${year}-01-01`, 12);
  });

  it('will not open a year outside the sane window (a mistyped date)', async () => {
    const findOne = jest.fn().mockResolvedValueOnce(null);
    const manager = { findOne } as unknown as EntityManager;
    const farYear = thisYear + 50;

    await expect(
      resolvePostingPeriod(manager, ORG, `${farYear}-03-15`, undefined, { createIfMissing: true }),
    ).rejects.toBeDefined();
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it('never reopens a closed or locked fiscal year', async () => {
    const findOne = jest
      .fn()
      .mockResolvedValueOnce(null) // nothing covers the date
      .mockResolvedValueOnce({ status: FiscalYearStatus.CLOSED }); // but the year is sealed
    const manager = { findOne } as unknown as EntityManager;

    await expect(
      resolvePostingPeriod(manager, ORG, `${thisYear}-03-15`, undefined, { createIfMissing: true }),
    ).rejects.toBeDefined();
    expect(ensureMock).not.toHaveBeenCalled();
  });
});
