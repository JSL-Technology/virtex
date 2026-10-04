import { In } from 'typeorm';
import { PayrollRunService } from './services/payroll-run.service';
import { PayrollRunStatus, PayrollRunType } from './entities/payroll-run.entity';

/** QA B-02: an employee's own payslips say which period they pay. */
describe('My payslips', () => {
  it('gives an employee their approved payslips with the period each one pays', async () => {
    const find = jest.fn(async () => [
      {
        id: 'p-1',
        netPay: 100,
        run: {
          periodYear: 2026,
          periodMonth: 8,
          periodStart: '2026-08-01',
          periodEnd: '2026-08-31',
          payDate: '2026-08-30',
          runType: PayrollRunType.REGULAR,
          currencyCode: 'DOP',
        },
      },
    ]);
    const service = Object.create(PayrollRunService.prototype) as PayrollRunService;
    Object.assign(service, {
      employees: { findOne: jest.fn(async () => ({ id: 'emp-1' })) },
      payslips: { find },
    });

    const [slip] = await service.payslipsForUser('user-1', 'org-1');

    expect(slip.period).toEqual({
      year: 2026,
      month: 8,
      start: '2026-08-01',
      end: '2026-08-31',
      payDate: '2026-08-30',
      runType: PayrollRunType.REGULAR,
      currencyCode: 'DOP',
    });
    expect(slip).not.toHaveProperty('run');
    const [options] = find.mock.calls[0] as unknown as [{ where: { run: { status: unknown } } }];
    expect(options.where.run.status).toEqual(In([PayrollRunStatus.APPROVED, PayrollRunStatus.PAID]));
  });});
