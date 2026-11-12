import { Injectable } from '@nestjs/common';
import { daysBetween } from '../../common/dates';
import { roundAmount, sumAmounts } from '../../common/money';
import { BadRequestError } from '../../i18n/localized.exception';
import { ConceptCalculation, ConceptType } from '../entities/payroll-concept.entity';
import { PayslipLineKind } from '../entities/payslip-line.entity';
import {
  ContributionResult,
  PayrollEngine,
  ResolvedParameters,
} from '../../markets/contracts';
import type { PayslipContribution } from '../entities/payslip.entity';

/**
 * Legal ordinary work hours in a month, for deriving the hourly wage overtime is a premium on.
 *
 * The Código de Trabajo (Art. 147) sets the ordinary week at 44 hours; averaged over the year that
 * is 44 × 52 ÷ 12 ≈ 190.67 hours a month. The value drives HOURLY concepts (overtime, night
 * premium); confirm against the applicable collective agreement where one narrows the week.
 */
const ORDINARY_WORK_HOURS_PER_MONTH = (44 * 52) / 12;

/** A non-statutory earning or deduction to apply to an employee this run. */
export interface ConceptInput {
  code: string;
  name: string;
  type: ConceptType;
  calculation: ConceptCalculation;
  taxable: boolean;
  contributesToSocialSecurity: boolean;
  /** For FIXED concepts. */
  amount?: number;
  /** For PERCENTAGE concepts — a fraction of the prorated base salary; for HOURLY — the premium multiplier. */
  rate?: number | null;
  /** For HOURLY concepts — the number of hours. */
  quantity?: number | null;
  sortOrder?: number;
}

export interface EmployeeCalculationInput {
  employeeId: string;
  employeeName: string;
  employeeIdentityMasked?: string | null;
  employeeSocialSecurityNumber?: string | null;
  hireDate?: string | null;
  terminationDate?: string | null;
  /** Contractual monthly salary in force for the period. */
  monthlyBaseSalary: number;
  currencyCode: string;
  concepts: ConceptInput[];
}

export interface RunPeriod {
  countryCode: string;
  periodStart: string;
  periodEnd: string;
}

export interface ComputedLine {
  conceptCode: string;
  conceptName: string;
  kind: PayslipLineKind;
  amount: number;
  employerPortion: number | null;
  base: number | null;
  rate: number | null;
  sortOrder: number;
}

export interface ComputedPayslip {
  employeeId: string;
  employeeName: string;
  employeeIdentityMasked: string | null;
  employeeSocialSecurityNumber: string | null;
  baseDays: number;
  workedDays: number;
  baseSalary: number;
  grossEarnings: number;
  contributoryBase: number;
  taxableBase: number;
  /** Every statutory contribution, by the country's catalogue code (audit 2026-11-07, JUR-01). */
  statutoryContributions: PayslipContribution[];
  statutoryEmployeeContributions: number;
  statutoryEmployerContributions: number;
  incomeTax: number;
  otherDeductions: number;
  /** Non-statutory employer costs (EMPLOYER_CONTRIBUTION concepts), booked as an expense. */
  otherEmployerContributions: number;
  totalEmployeeDeductions: number;
  totalEmployerContributions: number;
  netPay: number;
  currencyCode: string;
  lines: ComputedLine[];
}

/**
 * Turns an employee and a period into a payslip — the pure heart of the module.
 *
 * ## Why this is a pure function
 *
 * Every input arrives as an argument: the employee, their salary, the concepts, the resolved
 * parameters and the jurisdiction strategy. It reads no database and writes nothing, so it is
 * exhaustively unit-testable — a rate change, a cap edge, a mid-month hire are all table-driven
 * tests with no fixtures — and its result is exactly what {@link PayrollRunService} persists.
 *
 * ## The order matters
 *
 * Proration first (an employee who worked half the month earns and contributes on half), then
 * earnings (to know the contributory and taxable bases), then the statutory engine (pre-tax contributions before
 * ISR, because ISR is charged net of them), then the ordinary deductions and employer costs. Every
 * amount is rounded to cents through the shared money helpers, and the totals are summed in cents so
 * a long payslip cannot accumulate binary drift.
 */
@Injectable()
export class PayrollCalculationService {
  calculate(
    employee: EmployeeCalculationInput,
    period: RunPeriod,
    params: ResolvedParameters,
    strategy: PayrollEngine,
  ): ComputedPayslip {
    const { baseDays, workedDays } = this.proration(employee, period);
    const factor = baseDays > 0 ? workedDays / baseDays : 0;
    const proratedBase = roundAmount(employee.monthlyBaseSalary * factor);
    const conceptCtx = { proratedBase, monthlyBaseSalary: employee.monthlyBaseSalary };

    const lines: ComputedLine[] = [];
    const earningAmounts: number[] = [proratedBase];
    const taxableAmounts: number[] = [proratedBase];
    const contributoryAmounts: number[] = [proratedBase];

    lines.push({
      conceptCode: 'BASE',
      conceptName: 'Salario base',
      kind: PayslipLineKind.EARNING,
      amount: proratedBase,
      employerPortion: null,
      base: employee.monthlyBaseSalary,
      rate: null,
      sortOrder: 10,
    });

    // ── Configurable earnings ──────────────────────────────────────────────────
    for (const concept of employee.concepts.filter((c) => c.type === ConceptType.EARNING)) {
      const amount = this.conceptAmount(concept, conceptCtx);
      if (amount === 0) continue;
      earningAmounts.push(amount);
      if (concept.taxable) taxableAmounts.push(amount);
      if (concept.contributesToSocialSecurity) contributoryAmounts.push(amount);
      lines.push({
        conceptCode: concept.code,
        conceptName: concept.name,
        kind: PayslipLineKind.EARNING,
        amount,
        employerPortion: null,
        base: this.conceptLineBase(concept, conceptCtx),
        rate: concept.rate ?? null,
        sortOrder: concept.sortOrder ?? 50,
      });
    }

    const grossEarnings = sumAmounts(earningAmounts);
    const contributoryBase = sumAmounts(contributoryAmounts);
    const taxableEarnings = sumAmounts(taxableAmounts);

    // ── Statutory contributions and income tax, from the jurisdiction strategy ───
    const statutory = strategy.computeStatutory(
      { contributoryBase, taxableEarnings, prorationFactor: factor },
      params,
    );

    for (const contribution of statutory.contributions) {
      const isEmployee = contribution.employeeAmount > 0;
      const isEmployerOnly = contribution.employeeAmount === 0 && contribution.employerAmount > 0;
      lines.push({
        conceptCode: contribution.code,
        conceptName: this.conceptName(strategy, contribution.code),
        kind: isEmployerOnly
          ? PayslipLineKind.EMPLOYER_CONTRIBUTION
          : PayslipLineKind.EMPLOYEE_DEDUCTION,
        amount: isEmployerOnly ? contribution.employerAmount : contribution.employeeAmount,
        employerPortion: isEmployee ? contribution.employerAmount : null,
        base: contribution.appliedBase,
        rate: isEmployerOnly ? contribution.employerRate : contribution.employeeRate,
        sortOrder: 200,
      });
    }

    if (statutory.incomeTax > 0) {
      lines.push({
        conceptCode: strategy.incomeTaxConcept.code,
        conceptName: strategy.incomeTaxConcept.name,
        kind: PayslipLineKind.EMPLOYEE_DEDUCTION,
        amount: statutory.incomeTax,
        employerPortion: null,
        base: statutory.taxableBase,
        rate: null,
        sortOrder: 210,
      });
    }

    // ── Configurable deductions and employer contributions ─────────────────────
    const otherDeductionAmounts: number[] = [];
    const employerConceptAmounts: number[] = [];
    for (const concept of employee.concepts) {
      if (concept.type === ConceptType.DEDUCTION) {
        const amount = this.conceptAmount(concept, conceptCtx);
        if (amount === 0) continue;
        otherDeductionAmounts.push(amount);
        lines.push({
          conceptCode: concept.code,
          conceptName: concept.name,
          kind: PayslipLineKind.EMPLOYEE_DEDUCTION,
          amount,
          employerPortion: null,
          base: this.conceptLineBase(concept, conceptCtx),
          rate: concept.rate ?? null,
          sortOrder: concept.sortOrder ?? 300,
        });
      } else if (concept.type === ConceptType.EMPLOYER_CONTRIBUTION) {
        const amount = this.conceptAmount(concept, conceptCtx);
        if (amount === 0) continue;
        employerConceptAmounts.push(amount);
        lines.push({
          conceptCode: concept.code,
          conceptName: concept.name,
          kind: PayslipLineKind.EMPLOYER_CONTRIBUTION,
          amount,
          employerPortion: null,
          base: this.conceptLineBase(concept, conceptCtx),
          rate: concept.rate ?? null,
          sortOrder: concept.sortOrder ?? 400,
        });
      }
    }

    const otherDeductions = sumAmounts(otherDeductionAmounts);
    const otherEmployerContributions = sumAmounts(employerConceptAmounts);
    const totalEmployeeDeductions = sumAmounts([
      statutory.employeeContributions,
      statutory.incomeTax,
      otherDeductions,
    ]);
    const totalEmployerContributions = sumAmounts([
      statutory.employerContributions,
      otherEmployerContributions,
    ]);
    const netPay = roundAmount(grossEarnings - totalEmployeeDeductions);

    // A payslip whose voluntary deductions exceed the pay is not a payslip that can be issued: the
    // salary is partly unembargable under the Código de Trabajo, so an impossible net is refused here
    // rather than paid negative. Corrections are made by adjusting the offending deduction.
    if (netPay < 0) {
      throw new BadRequestError('payroll.deductions_p1_exceed_salary_net_pay', {
        p1: employee.employeeName,
      });
    }

    lines.sort((a, b) => a.sortOrder - b.sortOrder);

    return {
      employeeId: employee.employeeId,
      employeeName: employee.employeeName,
      employeeIdentityMasked: employee.employeeIdentityMasked ?? null,
      employeeSocialSecurityNumber: employee.employeeSocialSecurityNumber ?? null,
      baseDays,
      workedDays,
      baseSalary: proratedBase,
      grossEarnings,
      contributoryBase: contributoryBase,
      taxableBase: statutory.taxableBase,
      statutoryContributions: statutory.contributions.map(toPayslipContribution),
      statutoryEmployeeContributions: statutory.employeeContributions,
      statutoryEmployerContributions: statutory.employerContributions,
      incomeTax: statutory.incomeTax,
      otherDeductions,
      otherEmployerContributions,
      totalEmployeeDeductions,
      totalEmployerContributions,
      netPay,
      currencyCode: employee.currencyCode,
      lines,
    };
  }

  /**
   * A year-end bonus (regalía pascual) payslip.
   *
   * The bonus is one twelfth of the ordinary salary earned in the year; the caller supplies that
   * amount (computed from the year's actual earnings, or approximated). It is exempt from income tax
   * and outside the AFP/SFS base, so the only withholding is the employee INFOTEP levy the strategy
   * applies. A separate run type keeps it off the ordinary contributory/tax bases entirely.
   */
  calculateChristmasBonus(
    employee: EmployeeCalculationInput,
    bonusAmount: number,
    params: ResolvedParameters,
    strategy: PayrollEngine,
  ): ComputedPayslip {
    const gross = roundAmount(Math.max(0, bonusAmount));
    const bonus = strategy.computeBonus({ bonusAmount: gross }, params);

    const lines: ComputedLine[] = [
      {
        conceptCode: 'REGALIA',
        conceptName: 'Regalía pascual (salario de Navidad)',
        kind: PayslipLineKind.EARNING,
        amount: gross,
        employerPortion: null,
        base: null,
        rate: null,
        sortOrder: 10,
      },
    ];
    for (const levy of bonus.contributions) {
      if (levy.employeeAmount <= 0) continue;
      lines.push({
        conceptCode: `${levy.code}_EMP`,
        // The rate actually applied, not a literal: the label said 0.5 % while the seed withheld 1 %
        // (audit 2026-10-31, NOM-03), so the payslip contradicted itself.
        conceptName: `${this.conceptName(strategy, levy.code)} (${formatPercent(levy.employeeRate)})`,
        kind: PayslipLineKind.EMPLOYEE_DEDUCTION,
        amount: levy.employeeAmount,
        employerPortion: null,
        base: levy.appliedBase,
        rate: levy.employeeRate,
        sortOrder: 200,
      });
    }
    const levies = sumAmounts(bonus.contributions.map((c) => c.employeeAmount));

    return {
      employeeId: employee.employeeId,
      employeeName: employee.employeeName,
      employeeIdentityMasked: employee.employeeIdentityMasked ?? null,
      employeeSocialSecurityNumber: employee.employeeSocialSecurityNumber ?? null,
      baseDays: 0,
      workedDays: 0,
      baseSalary: 0,
      grossEarnings: gross,
      contributoryBase: 0,
      taxableBase: 0,
      statutoryContributions: bonus.contributions.map(toPayslipContribution),
      statutoryEmployeeContributions: levies,
      statutoryEmployerContributions: 0,
      incomeTax: 0,
      otherDeductions: 0,
      otherEmployerContributions: 0,
      totalEmployeeDeductions: levies,
      totalEmployerContributions: 0,
      netPay: bonus.net,
      currencyCode: employee.currencyCode,
      lines,
    };
  }

  /**
   * The difference between a freshly recomputed payslip and the one an approved run already booked —
   * the content of an adjustment run.
   *
   * Every monetary field is subtracted, so the result is what still has to be paid (or clawed back)
   * and what still has to be posted and declared. It is deliberately allowed to be negative. Line
   * detail is not diffed — an adjustment's lines are the corrected slip's, kept for the record — and
   * a slip whose every figure matches is reported via {@link isZeroPayslip} so the run can skip it.
   */
  diff(current: ComputedPayslip, previous: ComputedPayslip): ComputedPayslip {
    const d = (a: number, b: number) => roundAmount(a - b);
    return {
      ...current,
      grossEarnings: d(current.grossEarnings, previous.grossEarnings),
      contributoryBase: d(current.contributoryBase, previous.contributoryBase),
      taxableBase: d(current.taxableBase, previous.taxableBase),
      statutoryContributions: diffContributions(current.statutoryContributions, previous.statutoryContributions),
      statutoryEmployeeContributions: d(current.statutoryEmployeeContributions, previous.statutoryEmployeeContributions),
      statutoryEmployerContributions: d(current.statutoryEmployerContributions, previous.statutoryEmployerContributions),
      incomeTax: d(current.incomeTax, previous.incomeTax),
      otherDeductions: d(current.otherDeductions, previous.otherDeductions),
      otherEmployerContributions: d(
        current.otherEmployerContributions,
        previous.otherEmployerContributions,
      ),
      totalEmployeeDeductions: d(current.totalEmployeeDeductions, previous.totalEmployeeDeductions),
      totalEmployerContributions: d(
        current.totalEmployerContributions,
        previous.totalEmployerContributions,
      ),
      netPay: d(current.netPay, previous.netPay),
    };
  }

  /** True when every monetary field of a (delta) payslip is zero — nothing to book or declare. */
  isZeroPayslip(slip: ComputedPayslip): boolean {
    return (
      slip.grossEarnings === 0 &&
      slip.totalEmployeeDeductions === 0 &&
      slip.totalEmployerContributions === 0 &&
      slip.netPay === 0
    );
  }

  /**
   * Days worked in the period, out of the period's own length.
   *
   * A hire on the 16th of a 31-day month worked 16 days, not a whole month and not zero — the
   * audit's mid-period invariant. The window is the intersection of employment with the period; the
   * denominator is the period's actual days, so the proration is exact and never assumes a 30-day
   * month for a month that is not one.
   */
  private proration(
    employee: EmployeeCalculationInput,
    period: RunPeriod,
  ): { baseDays: number; workedDays: number } {
    const baseDays = daysBetween(period.periodStart, period.periodEnd) + 1;

    const start =
      employee.hireDate && employee.hireDate > period.periodStart
        ? employee.hireDate
        : period.periodStart;
    const end =
      employee.terminationDate && employee.terminationDate < period.periodEnd
        ? employee.terminationDate
        : period.periodEnd;

    if (start > end) return { baseDays, workedDays: 0 };
    const workedDays = Math.min(baseDays, Math.max(0, daysBetween(start, end) + 1));
    return { baseDays, workedDays };
  }

  private conceptAmount(
    concept: ConceptInput,
    ctx: { proratedBase: number; monthlyBaseSalary: number },
  ): number {
    // The engine's own invariant, whatever the caller validated (NOM-03, NOM-05): no concept is
    // negative — money to the employee is an EARNING, which is taxed and contributed on — and no
    // rate exceeds its calculation's ceiling.
    const ceiling = concept.calculation === ConceptCalculation.PERCENTAGE ? 1 : concept.calculation === ConceptCalculation.HOURLY ? 10 : Infinity;
    if (
      (concept.amount ?? 0) < 0 ||
      (concept.quantity ?? 0) < 0 ||
      (concept.rate ?? 0) < 0 ||
      (concept.rate ?? 0) > ceiling
    ) {
      throw new BadRequestError('payroll.concept_value_out_of_range', { concept: concept.code });
    }
    switch (concept.calculation) {
      case ConceptCalculation.PERCENTAGE:
        return roundAmount(ctx.proratedBase * (concept.rate ?? 0));
      case ConceptCalculation.HOURLY: {
        // Hours × ordinary hourly wage × premium multiplier. The hourly wage is the *ordinary*
        // monthly salary over the legal work-hours-per-month, so overtime is never derived from a
        // client-sent amount.
        const hourly = ctx.monthlyBaseSalary / ORDINARY_WORK_HOURS_PER_MONTH;
        return roundAmount((concept.quantity ?? 0) * hourly * (concept.rate ?? 0));
      }
      case ConceptCalculation.FIXED:
      default:
        return roundAmount(concept.amount ?? 0);
    }
  }

  /** The `base` a line records, so the payslip shows what a percentage/hourly amount was computed on. */
  private conceptLineBase(
    concept: ConceptInput,
    ctx: { proratedBase: number; monthlyBaseSalary: number },
  ): number | null {
    if (concept.calculation === ConceptCalculation.PERCENTAGE) return ctx.proratedBase;
    if (concept.calculation === ConceptCalculation.HOURLY) return concept.quantity ?? null;
    return null;
  }

  /** The payslip-line name of a contribution, from the country's own catalogue. */
  private conceptName(strategy: PayrollEngine, code: string): string {
    return strategy.contributionConcepts.find((concept) => concept.code === code)?.name ?? code;
  }
}

/** 0.005 → "0.5%". */
function formatPercent(rate: number | null | undefined): string {
  return `${Math.round(Number(rate ?? 0) * 100 * 1000) / 1000}%`;
}


function toPayslipContribution(c: ContributionResult): PayslipContribution {
  return {
    code: c.code,
    bucket: c.bucket,
    appliedBase: c.appliedBase,
    employeeRate: c.employeeRate,
    employerRate: c.employerRate,
    employeeAmount: c.employeeAmount,
    employerAmount: c.employerAmount,
  };
}

/**
 * Per-contribution difference between a recomputed payslip and the booked one, by code. A code
 * present on one side only is diffed against zero, so an adjustment can add or remove a fund.
 */
function diffContributions(current: PayslipContribution[], previous: PayslipContribution[]): PayslipContribution[] {
  const codes = [...new Set([...current.map((c) => c.code), ...previous.map((c) => c.code)])];
  return codes
    .map((code) => {
      const now = current.find((c) => c.code === code);
      const before = previous.find((c) => c.code === code);
      const shape = now ?? before!;
      return {
        ...shape,
        appliedBase: roundAmount((now?.appliedBase ?? 0) - (before?.appliedBase ?? 0)),
        employeeAmount: roundAmount((now?.employeeAmount ?? 0) - (before?.employeeAmount ?? 0)),
        employerAmount: roundAmount((now?.employerAmount ?? 0) - (before?.employerAmount ?? 0)),
      };
    })
    .filter((c) => c.employeeAmount !== 0 || c.employerAmount !== 0);
}
