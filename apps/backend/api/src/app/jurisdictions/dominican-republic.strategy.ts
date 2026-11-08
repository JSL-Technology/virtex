import { roundAmount } from '../common/money';
import { ContributionBase } from './contribution-regime';
import {
  BonusInput,
  BonusResult,
  ContributionConcept,
  ContributionResult,
  PayrollJurisdictionStrategy,
  ResolvedParameters,
  StatutoryIdentifierSpec,
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
/** The Dominican contribution codes, as the versioned rate table stores them. */
export const DO_CONTRIBUTION = Object.freeze({
  AFP: 'AFP',
  SFS: 'SFS',
  SRL: 'SRL',
  INFOTEP: 'INFOTEP',
} as const);

export class DominicanRepublicStrategy implements PayrollJurisdictionStrategy {
  readonly countryCode = 'DO';

  /**
   * The SDSS funds (Ley 87-01) and the INFOTEP levy (Ley 116-80). AFP and SFS employee shares are
   * deducted before ISR (Código Tributario, art. 296 as applied by the DGII); SRL and INFOTEP are
   * employer-borne. Verificar con contador local.
   */
  readonly contributionConcepts: readonly ContributionConcept[] = [
    { code: DO_CONTRIBUTION.AFP, labelKey: 'payroll.parameters.regime_label.afp', name: 'AFP (Fondo de Pensiones)', bucket: 'PENSION', reducesTaxableIncome: true },
    { code: DO_CONTRIBUTION.SFS, labelKey: 'payroll.parameters.regime_label.sfs', name: 'SFS (Seguro Familiar de Salud)', bucket: 'HEALTH', reducesTaxableIncome: true },
    { code: DO_CONTRIBUTION.SRL, labelKey: 'payroll.parameters.regime_label.srl', name: 'SRL (Seguro de Riesgos Laborales)', bucket: 'OTHER', reducesTaxableIncome: false },
    { code: DO_CONTRIBUTION.INFOTEP, labelKey: 'payroll.parameters.regime_label.infotep', name: 'INFOTEP', bucket: 'OTHER', reducesTaxableIncome: false },
  ];

  readonly incomeTaxConcept = { code: 'ISR', name: 'Impuesto sobre la renta (ISR)', labelKey: 'payroll.payslip.isr' };

  /**
   * What the TSS needs on an employee record, and the shape it needs it in.
   *
   * These three rules used to be a `@Matches(/^\d{7,11}$/)` on `CreateEmployeeDto` and three
   * columns named `tss_nss`, `afp_code` and `sfs_code` — Dominican institutions in the schema of a
   * table shared by nineteen markets, with the Dominican NSS format asserted against all of them.
   * The columns are neutrally named now and the rule sits here, where the country that imposes it
   * already lives. A market whose strategy declares nothing asserts nothing.
   */
  readonly statutoryIdentifiers: readonly StatutoryIdentifierSpec[] = [
    {
      field: 'socialSecurityNumber',
      labelKey: 'hcm.employees.form.social_security_number',
      pattern: '^\\d{7,11}$',
      messageKey: 'validation.create_employee.social_security_number_format',
      required: false,
    },
    // The AFP and the ARS/SFS are chosen from the SIPEN and SISALRIL registers of authorised
    // administrators. Their codes are short alphanumerics; no published check rule applies, so the
    // constraint is length alone rather than an invented one.
    {
      field: 'pensionFundCode',
      labelKey: 'hcm.employees.form.pension_fund_code',
      pattern: '^[A-Za-z0-9-]{1,32}$',
      messageKey: 'validation.create_employee.pension_fund_code_format',
      required: false,
    },
    {
      field: 'healthFundCode',
      labelKey: 'hcm.employees.form.health_fund_code',
      pattern: '^[A-Za-z0-9-]{1,32}$',
      messageKey: 'validation.create_employee.health_fund_code_format',
      required: false,
    },
  ];

  computeStatutory(input: StatutoryInput, params: ResolvedParameters): StatutoryResult {
    const contributions: ContributionResult[] = [];
    const prorationFactor = input.prorationFactor ?? 1;

    for (const contribution of params.contributions) {
      const concept = this.concept(contribution.code);
      const appliedBase = this.boundedBase(
        input.contributoryBase,
        contribution,
        params.minWageCotizable,
        prorationFactor,
      );
      contributions.push({
        code: concept.code,
        bucket: concept.bucket,
        appliedBase,
        employeeRate: contribution.employeeRate,
        employerRate: contribution.employerRate,
        employeeAmount: roundAmount(appliedBase * contribution.employeeRate),
        employerAmount: roundAmount(appliedBase * contribution.employerRate),
      });
    }

    const pretax = contributions
      .filter((c) => this.concept(c.code).reducesTaxableIncome)
      .reduce((sum, c) => sum + c.employeeAmount, 0);
    // ISR is charged on taxable earnings net of the employee's AFP + SFS. Rounded to cents so the
    // base tax is computed on cannot carry sub-cent drift.
    const taxableBase = roundAmount(Math.max(0, input.taxableEarnings - pretax));
    const incomeTax = this.incomeTax(taxableBase, prorationFactor, params);

    return {
      contributions,
      employeeContributions: roundAmount(contributions.reduce((sum, c) => sum + c.employeeAmount, 0)),
      employerContributions: roundAmount(contributions.reduce((sum, c) => sum + c.employerAmount, 0)),
      incomeTax,
      taxableBase,
    };
  }

  /** A rate row for a code the Dominican law does not levy is a data defect, refused loudly. */
  private concept(code: string): ContributionConcept {
    const concept = this.contributionConcepts.find((c) => c.code === code);
    if (!concept) {
      throw new Error(`Contribución desconocida para DO: "${code}". Revisa los parámetros de nómina.`);
    }
    return concept;
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
    const rate = params.bonusEmployeeLevyRate ?? 0;
    const levy = roundAmount(bonus * rate);
    const contributions: ContributionResult[] =
      levy > 0
        ? [{ code: DO_CONTRIBUTION.INFOTEP, bucket: 'OTHER', appliedBase: bonus, employeeRate: rate, employerRate: 0, employeeAmount: levy, employerAmount: 0 }]
        : [];
    return { contributions, net: roundAmount(bonus - levy) };
  }
}
