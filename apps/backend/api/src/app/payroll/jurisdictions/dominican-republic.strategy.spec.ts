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
    bonusEmployeeLevyRate: 0.005,
    contributions: [
      { regime: ContributionRegime.AFP, employeeRate: 0.0287, employerRate: 0.071, base: ContributionBase.SALARY_CAPPED, capMinWageMultiplier: 20, floorMinWageMultiplier: 1 },
      { regime: ContributionRegime.SFS, employeeRate: 0.0304, employerRate: 0.0709, base: ContributionBase.SALARY_CAPPED, capMinWageMultiplier: 10, floorMinWageMultiplier: 1 },
      { regime: ContributionRegime.SRL, employeeRate: 0, employerRate: 0.011, base: ContributionBase.SALARY_CAPPED, capMinWageMultiplier: 4, floorMinWageMultiplier: null },
      { regime: ContributionRegime.INFOTEP, employeeRate: 0, employerRate: 0.01, base: ContributionBase.PAYROLL_UNCAPPED, capMinWageMultiplier: null, floorMinWageMultiplier: null },
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

  it('lifts a full-time base below the minimum up to the contributory floor', () => {
    // 8000 is below the 10000 minimum; a full-period worker cotizes on the floor, not on 8000.
    const r = strategy.computeStatutory({ contributoryBase: 8000, taxableEarnings: 8000 }, params);
    const afp = r.contributions.find((c) => c.regime === ContributionRegime.AFP)!;
    expect(afp.appliedBase).toBe(10000);
    expect(r.afpEmployee).toBe(287); // 10000 × 2.87%
  });

  it('does not apply the floor to a part-month base (prorated worker)', () => {
    const r = strategy.computeStatutory(
      { contributoryBase: 8000, taxableEarnings: 8000, prorationFactor: 0.5 },
      params,
    );
    const afp = r.contributions.find((c) => c.regime === ContributionRegime.AFP)!;
    expect(afp.appliedBase).toBe(8000); // charged on what was actually earned
  });

  it('grosses a partial month up to a full month for the ISR scale, then prorates the tax', () => {
    // Half a 50000 salary = 25000 taxable-ish; annualising 25000 alone would fall in the exempt band.
    // Grossing up to 50000/yr places it in the 15% band, then the monthly tax is halved.
    const full = strategy.computeStatutory({ contributoryBase: 50000, taxableEarnings: 50000 }, params);
    const half = strategy.computeStatutory(
      { contributoryBase: 25000, taxableEarnings: 25000, prorationFactor: 0.5 },
      params,
    );
    expect(half.incomeTax).toBeGreaterThan(0);
    expect(half.incomeTax).toBeCloseTo(full.incomeTax / 2, 0);
  });

  it('taxes the year-end bonus as exempt from ISR but subject to the 0.5% employee INFOTEP levy', () => {
    const b = strategy.computeBonus({ bonusAmount: 30000 }, params);
    expect(b.infotepEmployee).toBe(150); // 30000 × 0.5%
    expect(b.net).toBe(29850);
  });
});
