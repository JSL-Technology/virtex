import { Injectable } from '@nestjs/common';
import { daysBetween } from '../../common/dates';
import { roundAmount, sumAmounts } from '../../common/money';
import { BadRequestError } from '../../i18n/localized.exception';
import { ConceptCalculation, ConceptType } from '../entities/payroll-concept.entity';
import { PayslipLineKind } from '../entities/payslip-line.entity';
import {
  PayrollJurisdictionStrategy,
  ResolvedParameters,
} from '../jurisdictions/jurisdiction-strategy.interface';
import { ContributionRegime } from '../entities/statutory-contribution.entity';

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
  contributesToTss: boolean;
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
  employeeTssNss?: string | null;
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
  employeeTssNss: string | null;
  baseDays: number;
  workedDays: number;
  baseSalary: number;
  grossEarnings: number;
  tssBase: number;
  taxableBase: number;
  afpEmployee: number;
  sfsEmployee: number;
  incomeTax: number;
  /** Employee INFOTEP levy — only on a year-end bonus run; zero on an ordinary run. */
  infotepEmployee: number;
  afpEmployer: number;
  sfsEmployer: number;
  srlEmployer: number;
  infotepEmployer: number;
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
 * earnings (to know the contributory and taxable bases), then the statutory engine (AFP/SFS before
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
    strategy: PayrollJurisdictionStrategy,
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
      if (concept.contributesToTss) contributoryAmounts.push(amount);
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

    // ── Statutory (AFP/SFS/SRL/INFOTEP + ISR), from the jurisdiction strategy ───
    const statutory = strategy.computeStatutory(
      { contributoryBase, taxableEarnings, prorationFactor: factor },
      params,
    );

    for (const contribution of statutory.contributions) {
      const isEmployee = contribution.employeeAmount > 0;
      const isEmployerOnly = contribution.employeeAmount === 0 && contribution.employerAmount > 0;
      lines.push({
        conceptCode: contribution.regime,
        conceptName: this.regimeName(contribution.regime),
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
        conceptCode: 'ISR',
        conceptName: 'Impuesto sobre la renta (ISR)',
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
      statutory.afpEmployee,
      statutory.sfsEmployee,
      statutory.incomeTax,
      otherDeductions,
    ]);
    const totalEmployerContributions = sumAmounts([
      statutory.afpEmployer,
      statutory.sfsEmployer,
      statutory.srlEmployer,
      statutory.infotepEmployer,
      otherEmployerContributions,
    ]);
    const netPay = roundAmount(grossEarnings - totalEmployeeDeductions);

    // A payslip whose voluntary deductions exceed the pay is not a payslip that can be issued: the
    // salary is partly unembargable under the Código de Trabajo, so an impossible net is refused here
    // rather than paid negative. Corrections are made by adjusting the offending deduction.
    if (netPay < 0) {
      throw new BadRequestError('PAYROLL.NETO_NEGATIVO_DEDUCCIONES_EXCEDEN_SALARIO', {
        p1: employee.employeeName,
      });
    }

    lines.sort((a, b) => a.sortOrder - b.sortOrder);

    return {
      employeeId: employee.employeeId,
      employeeName: employee.employeeName,
      employeeIdentityMasked: employee.employeeIdentityMasked ?? null,
      employeeTssNss: employee.employeeTssNss ?? null,
      baseDays,
      workedDays,
      baseSalary: proratedBase,
      grossEarnings,
      tssBase: contributoryBase,
      taxableBase: statutory.taxableBase,
      afpEmployee: statutory.afpEmployee,
      sfsEmployee: statutory.sfsEmployee,
      incomeTax: statutory.incomeTax,
      infotepEmployee: 0,
      afpEmployer: statutory.afpEmployer,
      sfsEmployer: statutory.sfsEmployer,
      srlEmployer: statutory.srlEmployer,
      infotepEmployer: statutory.infotepEmployer,
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
    strategy: PayrollJurisdictionStrategy,
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
    if (bonus.infotepEmployee > 0) {
      lines.push({
        conceptCode: 'INFOTEP_EMP',
        conceptName: 'INFOTEP empleado (0.5% sobre regalía)',
        kind: PayslipLineKind.EMPLOYEE_DEDUCTION,
        amount: bonus.infotepEmployee,
        employerPortion: null,
        base: gross,
        rate: params.bonusEmployeeLevyRate,
        sortOrder: 200,
      });
    }

    return {
      employeeId: employee.employeeId,
      employeeName: employee.employeeName,
      employeeIdentityMasked: employee.employeeIdentityMasked ?? null,
      employeeTssNss: employee.employeeTssNss ?? null,
      baseDays: 0,
      workedDays: 0,
      baseSalary: 0,
      grossEarnings: gross,
      tssBase: 0,
      taxableBase: 0,
      afpEmployee: 0,
      sfsEmployee: 0,
      incomeTax: 0,
      infotepEmployee: bonus.infotepEmployee,
      afpEmployer: 0,
      sfsEmployer: 0,
      srlEmployer: 0,
      infotepEmployer: 0,
      otherDeductions: 0,
      otherEmployerContributions: 0,
      totalEmployeeDeductions: bonus.infotepEmployee,
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
      tssBase: d(current.tssBase, previous.tssBase),
      taxableBase: d(current.taxableBase, previous.taxableBase),
      afpEmployee: d(current.afpEmployee, previous.afpEmployee),
      sfsEmployee: d(current.sfsEmployee, previous.sfsEmployee),
      incomeTax: d(current.incomeTax, previous.incomeTax),
      infotepEmployee: d(current.infotepEmployee, previous.infotepEmployee),
      afpEmployer: d(current.afpEmployer, previous.afpEmployer),
      sfsEmployer: d(current.sfsEmployer, previous.sfsEmployer),
      srlEmployer: d(current.srlEmployer, previous.srlEmployer),
      infotepEmployer: d(current.infotepEmployer, previous.infotepEmployer),
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

  private regimeName(regime: ContributionRegime): string {
    switch (regime) {
      case ContributionRegime.AFP:
        return 'AFP (Fondo de Pensiones)';
      case ContributionRegime.SFS:
        return 'SFS (Seguro Familiar de Salud)';
      case ContributionRegime.SRL:
        return 'SRL (Seguro de Riesgos Laborales)';
      case ContributionRegime.INFOTEP:
        return 'INFOTEP';
      default:
        return regime;
    }
  }
}
