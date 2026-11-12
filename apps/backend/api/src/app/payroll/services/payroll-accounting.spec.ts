import { PayrollAccountingService } from './payroll-accounting.service';
import type { Payslip, PayslipContribution } from '../entities/payslip.entity';

/**
 * The payroll entry routes each contribution by its BUCKET, never by a Dominican fund name (audit
 * 2026-11-07, JUR-01), and balances by construction.
 *
 * Worked by hand for one Dominican payslip of 50,000: AFP 1,435 / 3,550, SFS 1,520 / 3,545, SRL
 * 0 / 440, INFOTEP 0 / 500, ISR 1,854, net 45,191.
 *   DR salary 50,000 · DR employer contributions 8,035
 *   CR net 45,191 · CR pension 4,985 · CR health 5,065 · CR other 940 · CR ISR 1,854
 *   58,035 = 58,035.
 */
describe('PayrollAccountingService.postRun', () => {
  const settings = {
    defaultSalaryExpenseAccountId: 'salary',
    defaultEmployerContributionsExpenseAccountId: 'employer',
    defaultPayrollNetPayableAccountId: 'net',
    defaultPensionContributionsPayableAccountId: 'pension',
    defaultHealthContributionsPayableAccountId: 'health',
    defaultOtherPayrollContributionsPayableAccountId: 'other',
    defaultPayrollTaxWithholdingPayableAccountId: 'isr',
    defaultAccountsPayableId: 'ap',
  };
  const c = (code: string, bucket: PayslipContribution['bucket'], employeeAmount: number, employerAmount: number): PayslipContribution => ({
    code, bucket, appliedBase: 50000, employeeRate: 0, employerRate: 0, employeeAmount, employerAmount,
  });

  async function post(payslips: Partial<Payslip>[]) {
    const created: Array<{ lines: Array<{ accountId: string; debit: number; credit: number }> }> = [];
    const service = new PayrollAccountingService(
      { createWithManager: jest.fn(async (_m: unknown, dto: never) => { created.push(dto); return { id: 'je-1' }; }) } as never,
      { describeAll: jest.fn(async (_m: unknown, _o: unknown, specs: Record<string, unknown>) =>
          Object.fromEntries(Object.keys(specs).map((k) => [k, k]))) } as never,
      { requireDefault: jest.fn(async () => ({ id: 'ledger', currency: 'DOP' })) } as never,
      { requireByCode: jest.fn(async () => ({ id: 'journal' })) } as never,
      { getForOrg: jest.fn(async () => settings) } as never,
    );
    await service.postRun({} as never, { id: 'run', organizationId: 'org', currencyCode: 'DOP', periodEnd: '2026-01-31', name: 'QA' } as never, payslips as Payslip[], {} as never);
    const byAccount = new Map<string, number>();
    for (const line of created[0].lines) byAccount.set(line.accountId, (byAccount.get(line.accountId) ?? 0) + line.debit - line.credit);
    return byAccount;
  }

  it('posts the hand-worked Dominican entry, by bucket', async () => {
    const lines = await post([{
      grossEarnings: 50000, netPay: 45191, incomeTax: 1854, otherDeductions: 0, otherEmployerContributions: 0,
      statutoryEmployeeContributions: 2955, statutoryEmployerContributions: 8035,
      statutoryContributions: [c('AFP', 'PENSION', 1435, 3550), c('SFS', 'HEALTH', 1520, 3545), c('SRL', 'OTHER', 0, 440), c('INFOTEP', 'OTHER', 0, 500)],
    }]);
    expect(Object.fromEntries(lines)).toEqual({
      salary: 50000, employer: 8035, net: -45191, pension: -4985, health: -5065, other: -940, isr: -1854,
    });
    expect([...lines.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(0, 6);
  });

  it("routes another country's funds with no change to the posting", async () => {
    // Codes this service has never heard of; only the bucket matters.
    const lines = await post([{
      grossEarnings: 10000, netPay: 9500, incomeTax: 0, otherDeductions: 0, otherEmployerContributions: 0,
      statutoryEmployeeContributions: 500, statutoryEmployerContributions: 1200,
      statutoryContributions: [c('IMSS_EYM', 'HEALTH', 300, 700), c('RCV', 'PENSION', 200, 300), c('INFONAVIT', 'OTHER', 0, 200)],
    }]);
    expect(lines.get('health')).toBe(-1000);
    expect(lines.get('pension')).toBe(-500);
    expect(lines.get('other')).toBe(-200);
    expect([...lines.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(0, 6);
  });
});
