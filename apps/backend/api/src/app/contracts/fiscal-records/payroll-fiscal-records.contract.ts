/**
 * What a social-security filing needs from payroll, asked for without knowing who keeps it.
 *
 * A country's social-security authority is told two things about a period: what each worker was
 * paid and what each fund took from it (the Dominican autodeterminación, Mexico's SUA, Colombia's
 * PILA), and which workers joined, left or changed salary in it (the novedades). Both are payroll's
 * rows; the filing that declares them is its market's, and the module that builds returns may not
 * reach into payroll's tables — the question travels through this contract and is answered by the
 * module that owns the payslips.
 *
 * Plain data only: dates as `YYYY-MM-DD`, amounts as numbers in the run's currency.
 */
export interface PayrollFiscalQuery {
  readonly organizationId: string;
  /** First day of the period, inclusive. */
  readonly from: string;
  /** Last day of the period, inclusive. */
  readonly to: string;
  /** Four digits, and 1–12: a payroll period is a month, declared as such. */
  readonly year: number;
  readonly month: number;
}

/** One fund's share of one payslip, by the code the market's own catalogue gives the fund. */
export interface PayrollFiscalContribution {
  readonly code: string;
  readonly employeeAmount: number;
  readonly employerAmount: number;
}

/** One employee's payslip of the period, as a social-security filing reports it. */
export interface PayrollFiscalPayslip {
  readonly employeeName: string;
  /** The identifier the country's social security assigned the worker, where it is recorded. */
  readonly socialSecurityNumber: string | null;
  /** The base the statutory contributions were computed on. */
  readonly contributoryBase: number;
  readonly contributions: readonly PayrollFiscalContribution[];
}

/** Something the authority must be told about an employee in the period. */
export interface PayrollFiscalEvent {
  readonly kind: 'HIRE' | 'TERMINATION' | 'SALARY_CHANGE';
  readonly employeeName: string;
  readonly socialSecurityNumber: string | null;
  readonly effectiveDate: string;
  /** The salary the change sets, with its currency; null on a hire or a termination. */
  readonly salary: number | null;
  readonly currencyCode: string | null;
}

export interface PayrollFiscalRecordsSource {
  /** Stable identifier of the answering module. Never shown. */
  readonly sourceName: string;

  /**
   * The payslips of the period's APPROVED runs — what was actually paid, which is the only thing a
   * filing may declare. Empty when nothing of the period has been approved.
   */
  payslips(query: PayrollFiscalQuery): Promise<PayrollFiscalPayslip[]>;

  /** Hires, terminations and salary changes whose effective date falls in the period, in date order. */
  events(query: PayrollFiscalQuery): Promise<PayrollFiscalEvent[]>;
}
