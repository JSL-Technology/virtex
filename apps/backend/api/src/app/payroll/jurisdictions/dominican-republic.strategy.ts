import { roundAmount } from '../../common/money';
import { ContributionBase, ContributionRegime } from '../entities/statutory-contribution.entity';
import {
  BonusInput,
  BonusResult,
  ContributionResult,
  PayrollJurisdictionStrategy,
  ResolvedParameters,
  StatutoryInput,
  StatutoryResult,
} from './jurisdiction-strategy.interface';

/**
 * Dominican Republic payroll — SDSS contributions and DGII salaried income tax.
 *
 * ## What the law says, and where the numbers come from
 *
 * Nothing in this file is a rate. The rates, the caps and the ISR scale all arrive in `params`,
 * resolved from the versioned tables for the run's period, so this class holds the *rules* and never
 * the *values*. The rules it encodes:
 *
 * - **AFP, SFS, SRL** are applied to the salary capped at a regime-specific multiple of the minimum
 *   contributory wage (historically 20× for AFP, 10× for SFS, 4× for SRL). Each cap is applied
 *   independently, so a high earner's SFS base can be capped while their AFP base is not.
 * - **INFOTEP** is the employer's 1 % of the ordinary payroll, uncapped.
 * - **ISR** is charged on taxable earnings **net of the employee's own AFP and SFS** — the
 *   contributions are deducted before tax, which is why they are computed first here. The monthly
 *   taxable pay is annualised, run through the progressive scale, and divided back to the month.
 *
 * The employee/employer split is preserved for every regime, never combined.
 */
export class DominicanRepublicStrategy implements PayrollJurisdictionStrategy {
  readonly countryCode = 'DO';

  computeStatutory(input: StatutoryInput, params: ResolvedParameters): StatutoryResult {
    const contributions: ContributionResult[] = [];
    const prorationFactor = input.prorationFactor ?? 1;

    let afpEmployee = 0;
    let afpEmployer = 0;
    let sfsEmployee = 0;
    let sfsEmployer = 0;
    let srlEmployer = 0;
    let infotepEmployer = 0;

    for (const contribution of params.contributions) {
      const appliedBase = this.boundedBase(
        input.contributoryBase,
        contribution,
        params.minWageCotizable,
        prorationFactor,
      );
      const employeeAmount = roundAmount(appliedBase * contribution.employeeRate);
      const employerAmount = roundAmount(appliedBase * contribution.employerRate);

      contributions.push({
        regime: contribution.regime,
        appliedBase,
        employeeRate: contribution.employeeRate,
        employerRate: contribution.employerRate,
        employeeAmount,
        employerAmount,
      });

      switch (contribution.regime) {
        case ContributionRegime.AFP:
          afpEmployee += employeeAmount;
          afpEmployer += employerAmount;
          break;
        case ContributionRegime.SFS:
          sfsEmployee += employeeAmount;
          sfsEmployer += employerAmount;
          break;
        case ContributionRegime.SRL:
          srlEmployer += employerAmount;
          break;
        case ContributionRegime.INFOTEP:
          infotepEmployer += employerAmount;
          break;
      }
    }

    // ISR is charged on taxable earnings net of the employee's AFP + SFS. Rounded to cents so the
    // base tax is computed on cannot carry sub-cent drift.
    const taxableBase = roundAmount(
      Math.max(0, input.taxableEarnings - afpEmployee - sfsEmployee),
    );
    const incomeTax = this.incomeTax(taxableBase, prorationFactor, params);

    return {
      contributions,
      afpEmployee,
      afpEmployer,
      sfsEmployee,
      sfsEmployer,
      srlEmployer,
      infotepEmployer,
      incomeTax,
      taxableBase,
    };
  }

  /**
   * The base a regime's rate is applied to, after its floor and its cap.
   *
   * Uncapped regimes (INFOTEP) use the base as-is. Capped regimes clamp to `[floor, cap]`, each a
   * multiple of the minimum contributory wage; a missing multiplier means that bound does not apply,
   * rather than a zero bound, so a mis-seeded parameter never silently zeroes a contribution. The
   * floor is applied only to a full-period base (`prorationFactor === 1`): a mid-month worker
   * legitimately earned less than a monthly minimum and must not be charged as if they had not.
   */
  private boundedBase(
    base: number,
    contribution: { base: ContributionBase; capMinWageMultiplier: number | null; floorMinWageMultiplier: number | null },
    minWage: number,
    prorationFactor: number,
  ): number {
    if (contribution.base === ContributionBase.PAYROLL_UNCAPPED) {
      return roundAmount(base);
    }
    let bounded = base;
    if (contribution.floorMinWageMultiplier != null && prorationFactor >= 1) {
      bounded = Math.max(bounded, roundAmount(minWage * contribution.floorMinWageMultiplier));
    }
    if (contribution.capMinWageMultiplier != null) {
      bounded = Math.min(bounded, roundAmount(minWage * contribution.capMinWageMultiplier));
    }
    return roundAmount(bounded);
  }

  /**
   * Monthly income tax from the annualised taxable base and the progressive scale.
   *
   * The DGII scale is a function of the *ordinary* annual salary, so a partial month is grossed up to
   * a full month before the scale is applied and the resulting monthly tax is prorated back by the
   * same factor. Without this a mid-month hire's low prorated pay annualises below the exempt
   * threshold and is under-withheld. A full month (`prorationFactor === 1`) is unchanged: gross-up
   * and prorate-back are both identity.
   *
   * Annualise, locate the bracket by its lower bound, add the marginal step to the tax accumulated
   * at that bound, then divide back to the month. Below the exempt threshold the result is zero.
   */
  private incomeTax(
    monthlyTaxableBase: number,
    prorationFactor: number,
    params: ResolvedParameters,
  ): number {
    if (monthlyTaxableBase <= 0 || params.taxBrackets.length === 0) return 0;

    const fullMonth = prorationFactor > 0 ? monthlyTaxableBase / prorationFactor : monthlyTaxableBase;
    const annual = fullMonth * 12;
    // Brackets ascending; the applicable one is the highest whose lower bound the income reaches.
    const brackets = [...params.taxBrackets].sort((a, b) => a.lowerAnnual - b.lowerAnnual);
    let applicable = brackets[0];
    for (const bracket of brackets) {
      if (annual >= bracket.lowerAnnual) applicable = bracket;
      else break;
    }

    if (applicable.rate === 0) return 0;
    const annualTax = applicable.accumulatedTax + (annual - applicable.lowerAnnual) * applicable.rate;
    const fullMonthTax = Math.max(0, annualTax) / 12;
    return roundAmount(fullMonthTax * prorationFactor);
  }

  /**
   * The year-end bonus (regalía pascual): exempt from income tax and outside the AFP/SFS base, but
   * the worker's INFOTEP levy is withheld from it. The rate is versioned in `params`, never literal.
   */
  computeBonus(input: BonusInput, params: ResolvedParameters): BonusResult {
    const bonus = roundAmount(Math.max(0, input.bonusAmount));
    const infotepEmployee = roundAmount(bonus * (params.bonusEmployeeLevyRate ?? 0));
    return { infotepEmployee, net: roundAmount(bonus - infotepEmployee) };
  }
}
