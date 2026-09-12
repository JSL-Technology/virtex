import { roundAmount } from '../../common/money';
import { ContributionBase, ContributionRegime } from '../entities/statutory-contribution.entity';
import {
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

    let afpEmployee = 0;
    let afpEmployer = 0;
    let sfsEmployee = 0;
    let sfsEmployer = 0;
    let srlEmployer = 0;
    let infotepEmployer = 0;

    for (const contribution of params.contributions) {
      const appliedBase = this.cappedBase(
        input.contributoryBase,
        contribution.base,
        contribution.capMinWageMultiplier,
        params.minWageCotizable,
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
    const incomeTax = this.incomeTax(taxableBase, params);

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
   * The base a regime's rate is applied to, after its cap.
   *
   * Uncapped regimes (INFOTEP) use the base as-is. Capped regimes cap at `multiplier × minimum
   * contributory wage`; a missing multiplier is treated as uncapped rather than as a zero cap, so a
   * mis-seeded parameter never silently zeroes a contribution.
   */
  private cappedBase(
    base: number,
    baseKind: ContributionBase,
    capMultiplier: number | null,
    minWage: number,
  ): number {
    if (baseKind === ContributionBase.PAYROLL_UNCAPPED || capMultiplier == null) {
      return roundAmount(base);
    }
    const cap = roundAmount(minWage * capMultiplier);
    return roundAmount(Math.min(base, cap));
  }

  /**
   * Monthly income tax from the annualised taxable base and the progressive scale.
   *
   * Annualise, locate the bracket by its lower bound, add the marginal step to the tax accumulated
   * at that bound, then divide back to the month. Below the exempt threshold the result is zero.
   */
  private incomeTax(monthlyTaxableBase: number, params: ResolvedParameters): number {
    if (monthlyTaxableBase <= 0 || params.taxBrackets.length === 0) return 0;

    const annual = monthlyTaxableBase * 12;
    // Brackets ascending; the applicable one is the highest whose lower bound the income reaches.
    const brackets = [...params.taxBrackets].sort((a, b) => a.lowerAnnual - b.lowerAnnual);
    let applicable = brackets[0];
    for (const bracket of brackets) {
      if (annual >= bracket.lowerAnnual) applicable = bracket;
      else break;
    }

    if (applicable.rate === 0) return 0;
    const annualTax = applicable.accumulatedTax + (annual - applicable.lowerAnnual) * applicable.rate;
    return roundAmount(Math.max(0, annualTax) / 12);
  }
}
