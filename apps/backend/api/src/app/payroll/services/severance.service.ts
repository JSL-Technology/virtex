import { Injectable } from '@nestjs/common';
import { monthsBetween } from '../../common/dates';
import { roundAmount } from '../../common/money';

export interface SeveranceInput {
  monthlySalary: number;
  hireDate: string;
  /** Last day worked. */
  endDate: string;
  /**
   * Ordinary salary actually earned in the calendar year, for the regalía. When omitted it is
   * approximated from the monthly salary and the months worked in the year.
   */
  ordinarySalaryEarnedThisYear?: number;
  /** Months worked in the current calendar year, for the regalía approximation. Defaults to 12. */
  monthsWorkedThisYear?: number;
}

export interface SeveranceResult {
  monthsOfService: number;
  completedYears: number;
  /** Daily ordinary salary — monthly ÷ 23.83, the Código de Trabajo's average working days/month. */
  dailySalary: number;
  preavisoDays: number;
  preavisoAmount: number;
  cesantiaDays: number;
  cesantiaAmount: number;
  vacationDays: number;
  vacationAmount: number;
  /** Proportional Christmas bonus (regalía pascual). Exempt from ISR. */
  regaliaAmount: number;
  total: number;
}

/**
 * Labour severance and year-end benefits under the Dominican Código de Trabajo.
 *
 * ## Scope and honesty
 *
 * This encodes the *structure* of preaviso (Art. 76), auxilio de cesantía (Art. 80), vacaciones
 * (Art. 177) and the regalía pascual: the day tables and the ÷23.83 daily-salary divisor. These are
 * structural figures of the labour code that change far less often than TSS rates, so they are
 * constants here rather than versioned rows — but any edge case (proportional cesantía for a
 * partial final year, whether a specific bonus enters the base) should be **verified with
 * legal/RR.HH.** before it drives a payment, and is called out where it arises.
 *
 * The calculation is pure and DR-specific; when a second country needs severance it moves behind the
 * jurisdiction strategy, the same way the contributions already have.
 */
@Injectable()
export class SeveranceService {
  /** Average working days per month the labour code uses to derive a daily wage. */
  private static readonly WORKING_DAYS_PER_MONTH = 23.83;

  computeTermination(input: SeveranceInput): SeveranceResult {
    const months = this.serviceMonths(input.hireDate, input.endDate);
    const completedYears = Math.floor(months / 12);
    const dailySalary = roundAmount(input.monthlySalary / SeveranceService.WORKING_DAYS_PER_MONTH);

    const preavisoDays = this.preavisoDays(months);
    const cesantiaDays = this.cesantiaDays(months, completedYears);
    const vacationDays = this.vacationDays(months, completedYears);

    const preavisoAmount = roundAmount(dailySalary * preavisoDays);
    const cesantiaAmount = roundAmount(dailySalary * cesantiaDays);
    const vacationAmount = roundAmount(dailySalary * vacationDays);
    const regaliaAmount = this.regalia(input);

    return {
      monthsOfService: months,
      completedYears,
      dailySalary,
      preavisoDays,
      preavisoAmount,
      cesantiaDays,
      cesantiaAmount,
      vacationDays,
      vacationAmount,
      regaliaAmount,
      total: roundAmount(preavisoAmount + cesantiaAmount + vacationAmount + regaliaAmount),
    };
  }

  /**
   * Regalía pascual — one twelfth of the ordinary salary earned in the calendar year.
   *
   * Payable to every active employee before 20 December, and exempt from ISR. Uses the actual
   * salary earned when supplied; otherwise approximates it from the monthly salary and the months
   * worked in the year.
   */
  regalia(input: SeveranceInput): number {
    const earned =
      input.ordinarySalaryEarnedThisYear ??
      input.monthlySalary * (input.monthsWorkedThisYear ?? 12);
    return roundAmount(earned / 12);
  }

  /** Whole months of service, counting a started month only once its day-of-month is reached. */
  private serviceMonths(hireDate: string, endDate: string): number {
    const raw = monthsBetween(hireDate, endDate);
    // monthsBetween ignores the day; subtract one when the end day is earlier than the hire day, so
    // "hired the 20th, left the 10th" is not counted as a full final month.
    const hireDay = Number(hireDate.slice(8, 10));
    const endDay = Number(endDate.slice(8, 10));
    return Math.max(0, endDay >= hireDay ? raw : raw - 1);
  }

  /** Art. 76: 7 days (3–6 mo), 14 days (6–12 mo), 28 days (≥1 yr). Under 3 months: none. */
  private preavisoDays(months: number): number {
    if (months < 3) return 0;
    if (months < 6) return 7;
    if (months < 12) return 14;
    return 28;
  }

  /**
   * Art. 80: 6 days (3–6 mo), 13 days (6–12 mo), then per completed year — 21 days/year for the
   * first five, 23 days/year beyond. Completed years only; a partial final year is flagged for
   * legal review rather than assumed.
   */
  private cesantiaDays(months: number, completedYears: number): number {
    if (months < 3) return 0;
    if (months < 6) return 6;
    if (months < 12) return 13;
    const firstFive = Math.min(completedYears, 5) * 21;
    const beyond = Math.max(0, completedYears - 5) * 23;
    return firstFive + beyond;
  }

  /** Art. 177: 14 days after one year, 18 days after five. Proportional under a year. */
  private vacationDays(months: number, completedYears: number): number {
    if (months < 12) return roundAmount((14 * months) / 12);
    return completedYears >= 5 ? 18 : 14;
  }
}
