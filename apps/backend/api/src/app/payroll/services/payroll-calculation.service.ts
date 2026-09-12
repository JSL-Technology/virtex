import { Injectable } from '@nestjs/common';
import { daysBetween } from '../../common/dates';
import { roundAmount, sumAmounts } from '../../common/money';
import { ConceptCalculation, ConceptType } from '../entities/payroll-concept.entity';
import { PayslipLineKind } from '../entities/payslip-line.entity';
import {
  PayrollJurisdictionStrategy,
  ResolvedParameters,
} from '../jurisdictions/jurisdiction-strategy.interface';
import { ContributionRegime } from '../entities/statutory-contribution.entity';

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
  /** For PERCENTAGE concepts — a fraction of the prorated base salary. */
  rate?: number | null;
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
  afpEmployer: number;
  sfsEmployer: number;
  srlEmployer: number;
  infotepEmployer: number;
  otherDeductions: number;
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
      const amount = this.conceptAmount(concept, proratedBase);
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
        base: concept.calculation === ConceptCalculation.PERCENTAGE ? proratedBase : null,
        rate: concept.rate ?? null,
        sortOrder: concept.sortOrder ?? 50,
      });
    }

    const grossEarnings = sumAmounts(earningAmounts);
    const contributoryBase = sumAmounts(contributoryAmounts);
    const taxableEarnings = sumAmounts(taxableAmounts);

    // ── Statutory (AFP/SFS/SRL/INFOTEP + ISR), from the jurisdiction strategy ───
    const statutory = strategy.computeStatutory({ contributoryBase, taxableEarnings }, params);

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
        const amount = this.conceptAmount(concept, proratedBase);
        if (amount === 0) continue;
        otherDeductionAmounts.push(amount);
        lines.push({
          conceptCode: concept.code,
          conceptName: concept.name,
          kind: PayslipLineKind.EMPLOYEE_DEDUCTION,
          amount,
          employerPortion: null,
          base: concept.calculation === ConceptCalculation.PERCENTAGE ? proratedBase : null,
          rate: concept.rate ?? null,
          sortOrder: concept.sortOrder ?? 300,
        });
      } else if (concept.type === ConceptType.EMPLOYER_CONTRIBUTION) {
        const amount = this.conceptAmount(concept, proratedBase);
        if (amount === 0) continue;
        employerConceptAmounts.push(amount);
        lines.push({
          conceptCode: concept.code,
          conceptName: concept.name,
          kind: PayslipLineKind.EMPLOYER_CONTRIBUTION,
          amount,
          employerPortion: null,
          base: concept.calculation === ConceptCalculation.PERCENTAGE ? proratedBase : null,
          rate: concept.rate ?? null,
          sortOrder: concept.sortOrder ?? 400,
        });
      }
    }

    const otherDeductions = sumAmounts(otherDeductionAmounts);
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
      ...employerConceptAmounts,
    ]);
    const netPay = roundAmount(grossEarnings - totalEmployeeDeductions);

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
      afpEmployer: statutory.afpEmployer,
      sfsEmployer: statutory.sfsEmployer,
      srlEmployer: statutory.srlEmployer,
      infotepEmployer: statutory.infotepEmployer,
      otherDeductions,
      totalEmployeeDeductions,
      totalEmployerContributions,
      netPay,
      currencyCode: employee.currencyCode,
      lines,
    };
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

  private conceptAmount(concept: ConceptInput, proratedBase: number): number {
    if (concept.calculation === ConceptCalculation.PERCENTAGE) {
      return roundAmount(proratedBase * (concept.rate ?? 0));
    }
    return roundAmount(concept.amount ?? 0);
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
