import { DominicanRepublicStrategy } from './dominican-republic.strategy';
import { ResolvedParameters } from './jurisdiction-strategy.interface';
import {
  ContributionBase,
  ContributionRegime,
} from '../entities/statutory-contribution.entity';

/**
 * The Dominican calculation, proven against hand-worked figures.
 *
 * The parameters are built explicitly (not read from the seed) so each case is deterministic and a
 * rate change in the seed never silently moves an assertion here.
 */
describe('DominicanRepublicStrategy', () => {
  const strategy = new DominicanRepublicStrategy();

  const params: ResolvedParameters = {
    countryCode: 'DO',
    effectiveDate: '2026-01-31',
    minWageCotizable: 10000,
    currencyCode: 'DOP',
    contributions: [
      { regime: ContributionRegime.AFP, employeeRate: 0.0287, employerRate: 0.071, base: ContributionBase.SALARY_CAPPED, capMinWageMultiplier: 20 },
      { regime: ContributionRegime.SFS, employeeRate: 0.0304, employerRate: 0.0709, base: ContributionBase.SALARY_CAPPED, capMinWageMultiplier: 10 },
      { regime: ContributionRegime.SRL, employeeRate: 0, employerRate: 0.011, base: ContributionBase.SALARY_CAPPED, capMinWageMultiplier: 4 },
      { regime: ContributionRegime.INFOTEP, employeeRate: 0, employerRate: 0.01, base: ContributionBase.PAYROLL_UNCAPPED, capMinWageMultiplier: null },
    ],
    taxBrackets: [
      { lowerAnnual: 0, upperAnnual: 416220, rate: 0, accumulatedTax: 0 },
      { lowerAnnual: 416220, upperAnnual: 624329, rate: 0.15, accumulatedTax: 0 },
      { lowerAnnual: 624329, upperAnnual: 867123, rate: 0.2, accumulatedTax: 31216 },
      { lowerAnnual: 867123, upperAnnual: null, rate: 0.25, accumulatedTax: 79776 },
    ],
  };

  it('computes AFP/SFS/SRL/INFOTEP and ISR for a salary below every cap', () => {
    const r = strategy.computeStatutory({ contributoryBase: 50000, taxableEarnings: 50000 }, params);

    // Employee shares withheld.
    expect(r.afpEmployee).toBe(1435); // 50000 × 2.87%
    expect(r.sfsEmployee).toBe(1520); // 50000 × 3.04%
    // Employer shares (kept separate).
    expect(r.afpEmployer).toBe(3550); // 50000 × 7.10%
    expect(r.sfsEmployer).toBe(3545); // 50000 × 7.09%
    expect(r.srlEmployer).toBe(440); // capped at 4× = 40000 × 1.10%
    expect(r.infotepEmployer).toBe(500); // uncapped 50000 × 1%

    // ISR is charged net of the employee's AFP+SFS.
    expect(r.taxableBase).toBe(47045); // 50000 − 1435 − 1520
    // annual 564540 → (564540−416220)×15% = 22248 → ÷12
    expect(r.incomeTax).toBe(1854);
  });

  it('applies each contribution cap independently for a high earner', () => {
    const r = strategy.computeStatutory(
      { contributoryBase: 300000, taxableEarnings: 300000 },
      params,
    );

    expect(r.afpEmployee).toBe(5740); // capped at 20× = 200000 × 2.87%
    expect(r.sfsEmployee).toBe(3040); // capped at 10× = 100000 × 3.04%
    expect(r.srlEmployer).toBe(440); // capped at 4× = 40000 × 1.10%
    expect(r.infotepEmployer).toBe(3000); // uncapped 300000 × 1%

    // Top ISR bracket: 79776 + (3,494,640 − 867,123) × 25%, ÷12.
    expect(r.incomeTax).toBe(61387.94);
  });

  it('charges no income tax below the exempt threshold', () => {
    const r = strategy.computeStatutory({ contributoryBase: 20000, taxableEarnings: 20000 }, params);
    expect(r.incomeTax).toBe(0);
    // Contributions still apply.
    expect(r.afpEmployee).toBe(574);
    expect(r.sfsEmployee).toBe(608);
  });

  it('keeps the employee and employer AFP shares as separate amounts', () => {
    const r = strategy.computeStatutory({ contributoryBase: 50000, taxableEarnings: 50000 }, params);
    const afp = r.contributions.find((c) => c.regime === ContributionRegime.AFP)!;
    expect(afp.employeeAmount).toBe(1435);
    expect(afp.employerAmount).toBe(3550);
    expect(afp.employeeAmount).not.toBe(afp.employerAmount);
  });
});
