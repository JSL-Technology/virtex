import { PayrollCalculationService, RunPeriod } from './payroll-calculation.service';
import { DO_CONTRIBUTION as C, DominicanRepublicStrategy } from '../../jurisdictions/dominican-republic.strategy';
import { ResolvedParameters } from '../../jurisdictions/jurisdiction-strategy.interface';
import { ConceptCalculation, ConceptType } from '../entities/payroll-concept.entity';
import { PayslipLineKind } from '../entities/payslip-line.entity';
import { ContributionBase } from '../entities/statutory-contribution.entity';
import type { ComputedPayslip } from './payroll-calculation.service';

/** One fund's employee share on a computed payslip, by code. */
const ee = (slip: ComputedPayslip, code: string) =>
  slip.statutoryContributions.find((c) => c.code === code)?.employeeAmount ?? 0;

describe('PayrollCalculationService', () => {
  const service = new PayrollCalculationService();
  const strategy = new DominicanRepublicStrategy();
  const period: RunPeriod = { countryCode: 'DO', periodStart: '2026-01-01', periodEnd: '2026-01-31' };

  const params: ResolvedParameters = {
    countryCode: 'DO',
    effectiveDate: '2026-01-31',
    minWageCotizable: 10000,
    currencyCode: 'DOP',
    bonusEmployeeLevyRate: 0.005,
    contributions: [
      { code: C.AFP, employeeRate: 0.0287, employerRate: 0.071, base: ContributionBase.SALARY_CAPPED, capMinWageMultiplier: 20, floorMinWageMultiplier: 1 },
      { code: C.SFS, employeeRate: 0.0304, employerRate: 0.0709, base: ContributionBase.SALARY_CAPPED, capMinWageMultiplier: 10, floorMinWageMultiplier: 1 },
      { code: C.SRL, employeeRate: 0, employerRate: 0.011, base: ContributionBase.SALARY_CAPPED, capMinWageMultiplier: 4, floorMinWageMultiplier: null },
      { code: C.INFOTEP, employeeRate: 0, employerRate: 0.01, base: ContributionBase.PAYROLL_UNCAPPED, capMinWageMultiplier: null, floorMinWageMultiplier: null },
    ],
    taxBrackets: [
      { lowerAnnual: 0, upperAnnual: 416220, rate: 0, accumulatedTax: 0 },
      { lowerAnnual: 416220, upperAnnual: 624329, rate: 0.15, accumulatedTax: 0 },
      { lowerAnnual: 624329, upperAnnual: 867123, rate: 0.2, accumulatedTax: 31216 },
      { lowerAnnual: 867123, upperAnnual: null, rate: 0.25, accumulatedTax: 79776 },
    ],
  };

  const employee = (over: Partial<Parameters<typeof service.calculate>[0]> = {}) => ({
    employeeId: 'e1',
    employeeName: 'Juana Pérez',
    monthlyBaseSalary: 50000,
    currencyCode: 'DOP',
    concepts: [],
    ...over,
  });

  it('computes a full-month payslip end to end', () => {
    const slip = service.calculate(employee(), period, params, strategy);

    expect(slip.baseDays).toBe(31);
    expect(slip.workedDays).toBe(31);
    expect(slip.grossEarnings).toBe(50000);
    expect(ee(slip, C.AFP)).toBe(1435);
    expect(ee(slip, C.SFS)).toBe(1520);
    expect(slip.incomeTax).toBe(1854);
    expect(slip.totalEmployeeDeductions).toBe(4809);
    expect(slip.netPay).toBe(45191);
    // Employer cost is separate from what the employee takes home.
    expect(slip.totalEmployerContributions).toBe(3550 + 3545 + 440 + 500);
  });

  it('prorates a mid-month hire by the days actually worked', () => {
    const slip = service.calculate(
      employee({ monthlyBaseSalary: 30000, hireDate: '2026-01-16' }),
      period,
      params,
      strategy,
    );

    expect(slip.baseDays).toBe(31);
    expect(slip.workedDays).toBe(16);
    expect(slip.baseSalary).toBe(15483.87); // 30000 × 16/31
    expect(slip.grossEarnings).toBe(15483.87);
    expect(slip.netPay).toBeLessThan(slip.grossEarnings);
  });

  it('prorates a mid-month termination', () => {
    const slip = service.calculate(
      employee({ monthlyBaseSalary: 30000, terminationDate: '2026-01-15' }),
      period,
      params,
      strategy,
    );
    expect(slip.workedDays).toBe(15);
    expect(slip.baseSalary).toBe(roundedProration(30000, 15, 31));
  });

  it('adds a taxable earning concept to the gross and to a line', () => {
    const slip = service.calculate(
      employee({
        concepts: [
          {
            code: 'BONO',
            name: 'Bono',
            type: ConceptType.EARNING,
            calculation: ConceptCalculation.FIXED,
            taxable: true,
            contributesToSocialSecurity: true,
            amount: 5000,
          },
        ],
      }),
      period,
      params,
      strategy,
    );

    expect(slip.grossEarnings).toBe(55000);
    expect(slip.lines.some((l) => l.conceptCode === 'BONO' && l.kind === PayslipLineKind.EARNING)).toBe(
      true,
    );
  });

  it('every payslip balances: gross − employee deductions = net', () => {
    const slip = service.calculate(employee({ monthlyBaseSalary: 87654.32 }), period, params, strategy);
    expect(Math.round((slip.grossEarnings - slip.totalEmployeeDeductions - slip.netPay) * 100)).toBe(0);
  });

  it('computes overtime as hours × ordinary hourly wage × premium, server-side', () => {
    const slip = service.calculate(
      employee({
        monthlyBaseSalary: 50000,
        concepts: [
          {
            code: 'HE35',
            name: 'Horas extras 35%',
            type: ConceptType.EARNING,
            calculation: ConceptCalculation.HOURLY,
            taxable: true,
            contributesToSocialSecurity: true,
            rate: 1.35,
            quantity: 10,
          },
        ],
      }),
      period,
      params,
      strategy,
    );
    const ot = slip.lines.find((l) => l.conceptCode === 'HE35');
    // 50000 / (44×52/12) × 10 × 1.35 ≈ 3540.21
    expect(ot?.amount).toBeCloseTo(3540.21, 2);
    expect(slip.grossEarnings).toBeGreaterThan(50000);
  });

  it('refuses a payslip whose deductions push the net below zero', () => {
    expect(() =>
      service.calculate(
        employee({
          monthlyBaseSalary: 20000,
          concepts: [
            {
              code: 'LOAN',
              name: 'Préstamo',
              type: ConceptType.DEDUCTION,
              calculation: ConceptCalculation.FIXED,
              taxable: false,
              contributesToSocialSecurity: false,
              amount: 25000,
            },
          ],
        }),
        period,
        params,
        strategy,
      ),
    ).toThrow();
  });

  // NOM-03: a negative deduction raised the net by an amount nobody taxed or contributed on.
  it('refuses a negative deduction instead of paying it out untaxed', () => {
    expect(() =>
      service.calculate(
        employee({
          concepts: [
            { code: 'QAPRE', name: 'Préstamo', type: ConceptType.DEDUCTION, calculation: ConceptCalculation.FIXED, taxable: false, contributesToSocialSecurity: false, amount: -20000 },
          ],
        }),
        period,
        params,
        strategy,
      ),
    ).toThrow(expect.objectContaining({ messageKey: 'payroll.concept_value_out_of_range' }));
  });

  // NOM-05: a rate of 50 on a commission paid 50 × the salary.
  it('refuses a percentage above 100 % and a multiplier above 10, whoever set them', () => {
    const commission = (rate: number) =>
      service.calculate(
        employee({
          concepts: [
            { code: 'QACOM', name: 'Comisión', type: ConceptType.EARNING, calculation: ConceptCalculation.PERCENTAGE, taxable: true, contributesToSocialSecurity: true, rate },
          ],
        }),
        period,
        params,
        strategy,
      );
    expect(() => commission(50)).toThrow(expect.objectContaining({ messageKey: 'payroll.concept_value_out_of_range' }));
    expect(commission(0.05).grossEarnings).toBeGreaterThan(50000);
    expect(() =>
      service.calculate(
        employee({
          concepts: [
            { code: 'HE35', name: 'Horas extra', type: ConceptType.EARNING, calculation: ConceptCalculation.HOURLY, taxable: true, contributesToSocialSecurity: true, quantity: 10, rate: 35 },
          ],
        }),
        period,
        params,
        strategy,
      ),
    ).toThrow(expect.objectContaining({ messageKey: 'payroll.concept_value_out_of_range' }));
  });

  it('computes a 13th-month (regalía) payslip: exempt from ISR, only the 0.5% INFOTEP levy', () => {
    const slip = service.calculateChristmasBonus(employee(), 30000, params, strategy);
    expect(slip.grossEarnings).toBe(30000);
    expect(slip.incomeTax).toBe(0);
    expect(ee(slip, C.AFP)).toBe(0);
    expect(ee(slip, C.INFOTEP)).toBe(150);
    expect(slip.netPay).toBe(29850);
  });

  it('diffs two payslips into a delta for an adjustment run', () => {
    const before = service.calculate(employee({ monthlyBaseSalary: 50000 }), period, params, strategy);
    const after = service.calculate(employee({ monthlyBaseSalary: 55000 }), period, params, strategy);
    const delta = service.diff(after, before);
    expect(delta.grossEarnings).toBe(5000);
    // 5000 more salary: 5000 × 2.87 % more AFP, per code, so the adjustment is declared by fund.
    expect(ee(delta, C.AFP)).toBe(143.5);
    expect(service.diff(before, before).statutoryContributions).toEqual([]);
    expect(delta.netPay).toBeGreaterThan(0);
    expect(service.isZeroPayslip(service.diff(before, before))).toBe(true);
  });
});

function roundedProration(monthly: number, worked: number, base: number): number {
  return Math.round(((monthly * worked) / base) * 100) / 100;
}
