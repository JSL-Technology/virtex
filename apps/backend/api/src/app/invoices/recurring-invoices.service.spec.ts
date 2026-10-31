import { RecurringInvoicesService } from './recurring-invoices.service';
import { RecurringFrequency } from './entities/recurring-invoice.entity';

describe('RecurringInvoicesService calendar', () => {
  it.each([
    ['2026-01-15', '2026-01-15', RecurringFrequency.MONTHLY, '2026-02-15'],
    ['2026-01-31', '2026-01-31', RecurringFrequency.MONTHLY, '2026-02-28'],
    ['2026-01-31', '2026-02-28', RecurringFrequency.MONTHLY, '2026-03-31'],
    ['2024-01-31', '2024-01-31', RecurringFrequency.MONTHLY, '2024-02-29'],
    ['2026-11-10', '2026-11-10', RecurringFrequency.QUARTERLY, '2027-02-10'],
    ['2026-03-01', '2026-03-01', RecurringFrequency.SEMIANNUAL, '2026-09-01'],
    ['2026-03-01', '2026-03-01', RecurringFrequency.ANNUAL, '2027-03-01'],
    ['2026-12-05', '2026-12-05', RecurringFrequency.BIMONTHLY, '2027-02-05'],
  ])('start %s, from %s, %s → %s', (start, from, frequency, expected) => {
    expect(RecurringInvoicesService.advance(start, from, frequency)).toBe(expected);
  });

  it('labels the period the invoice covers', () => {
    expect(RecurringInvoicesService.periodLabel('2026-10-01', RecurringFrequency.MONTHLY)).toBe('Período 2026-10');
    expect(RecurringInvoicesService.periodLabel('2026-11-01', RecurringFrequency.QUARTERLY)).toBe('Período 2026-11 a 2027-01');
  });
});
