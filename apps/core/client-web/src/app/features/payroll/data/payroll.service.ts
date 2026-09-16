import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type PayrollRunStatus = 'DRAFT' | 'CALCULATED' | 'APPROVED' | 'PAID' | 'CANCELLED';
export type PayrollRunType = 'REGULAR' | 'CHRISTMAS_BONUS' | 'ADJUSTMENT';
export type ConceptType = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION';
export type ConceptCalculation = 'FIXED' | 'PERCENTAGE' | 'HOURLY' | 'STATUTORY';
export type PayslipLineKind = ConceptType;

export interface PayrollRun {
  id: string;
  name: string;
  countryCode: string;
  periodYear: number;
  periodMonth: number;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  runType: PayrollRunType;
  status: PayrollRunStatus;
  totalGross: number;
  totalEmployeeDeductions: number;
  totalNet: number;
  totalEmployerContributions: number;
  currencyCode: string;
  correctsRunId: string | null;
  journalEntryId: string | null;
  paymentJournalEntryId: string | null;
  calculatedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface PayslipLine {
  id: string;
  conceptCode: string;
  conceptName: string;
  kind: PayslipLineKind;
  amount: number;
  employerPortion: number | null;
  base: number | null;
  rate: number | null;
  sortOrder: number;
}

export interface Payslip {
  id: string;
  runId: string;
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
  infotepEmployee: number;
  afpEmployer: number;
  sfsEmployer: number;
  srlEmployer: number;
  infotepEmployer: number;
  otherDeductions: number;
  otherEmployerContributions: number;
  totalEmployeeDeductions: number;
  totalEmployerContributions: number;
  netPay: number;
  lines?: PayslipLine[];
}

export interface PayrollConcept {
  id: string;
  code: string;
  name: string;
  type: ConceptType;
  calculation: ConceptCalculation;
  rate: number | null;
  taxable: boolean;
  contributesToTss: boolean;
  accountId: string | null;
  sortOrder: number;
  active: boolean;
  isSystem: boolean;
}

export interface PayrollInput {
  id?: string;
  employeeId: string;
  conceptCode: string;
  amount?: number | null;
  quantity?: number | null;
  rate?: number | null;
  note?: string | null;
}

/** AFP (pension), SFS (health), SRL (labour risk), INFOTEP (training levy). */
export type ContributionRegime = 'AFP' | 'SFS' | 'SRL' | 'INFOTEP';
/** What a rate is applied to: a capped salary, or the whole uncapped payroll. */
export type ContributionBase = 'SALARY_CAPPED' | 'PAYROLL_UNCAPPED';
export type StatutoryReferenceKey =
  | 'MIN_WAGE_COTIZABLE'
  | 'ISR_ANNUAL_EXEMPT'
  | 'BONUS_EMPLOYEE_LEVY_RATE';

/**
 * One social-security rate, in force over a date range.
 *
 * Versioned rather than constant: a rate is a fact about a *moment*. A payroll recomputed after a
 * rate change must still produce what it produced at the time.
 */
export interface StatutoryContribution {
  id?: string;
  countryCode: string;
  regime: ContributionRegime;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Fractions, not percentages: 0.0287, never 2.87. */
  employeeRate: number;
  employerRate: number;
  base: ContributionBase;
  capMinWageMultiplier: number | null;
  floorMinWageMultiplier: number | null;
}

export interface StatutoryReference {
  id?: string;
  countryCode: string;
  key: StatutoryReferenceKey;
  effectiveFrom: string;
  effectiveTo: string | null;
  value: number;
  currencyCode: string;
}

export interface IncomeTaxBracket {
  id?: string;
  countryCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  lowerAnnual: number;
  upperAnnual: number | null;
  rate: number;
  accumulatedTax: number;
}

/**
 * What a termination would cost, under the Dominican Código de Trabajo.
 *
 * Preaviso (Art. 76), auxilio de cesantía (Art. 80), vacaciones (Art. 177) and the proportional
 * regalía, from a daily wage of monthly ÷ 23.83.
 */
export interface SeverancePreview {
  monthsOfService: number;
  completedYears: number;
  dailySalary: number;
  preavisoDays: number;
  preavisoAmount: number;
  cesantiaDays: number;
  cesantiaAmount: number;
  vacationDays: number;
  vacationAmount: number;
  regaliaAmount: number;
  total: number;
}

export interface PayrollPage<T> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/**
 * Payroll HTTP client — canonical location is `features/payroll/data/`.
 * `core/api/payroll.service.ts` re-exports everything here for backward compatibility.
 */
@Injectable({ providedIn: 'root' })
export class PayrollService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/payroll`;

  // ── Runs ───────────────────────────────────────────────────────────────────

  listRuns(page = 1, pageSize = 50): Observable<PayrollPage<PayrollRun>> {
    return this.http.get<PayrollPage<PayrollRun>>(`${this.apiUrl}/runs`, {
      params: new HttpParams().set('page', page).set('pageSize', pageSize),
    });
  }

  getRun(id: string): Observable<PayrollRun> {
    return this.http.get<PayrollRun>(`${this.apiUrl}/runs/${id}`);
  }

  createRun(body: {
    name?: string;
    periodYear: number;
    periodMonth: number;
    payDate?: string;
    runType?: PayrollRunType;
    correctsRunId?: string;
  }): Observable<PayrollRun> {
    return this.http.post<PayrollRun>(`${this.apiUrl}/runs`, body);
  }

  calculate(id: string): Observable<PayrollRun> {
    return this.http.post<PayrollRun>(`${this.apiUrl}/runs/${id}/calculate`, {});
  }

  /** Posts the accounting entry. From here the run is immutable: a mistake takes an adjustment run. */
  approve(id: string): Observable<PayrollRun> {
    return this.http.post<PayrollRun>(`${this.apiUrl}/runs/${id}/approve`, {});
  }

  pay(id: string, bankGlAccountId?: string): Observable<PayrollRun> {
    return this.http.post<PayrollRun>(`${this.apiUrl}/runs/${id}/pay`, { bankGlAccountId });
  }

  cancel(id: string): Observable<PayrollRun> {
    return this.http.post<PayrollRun>(`${this.apiUrl}/runs/${id}/cancel`, {});
  }

  // ── Variable inputs ────────────────────────────────────────────────────────

  listInputs(runId: string): Observable<PayrollInput[]> {
    return this.http.get<PayrollInput[]>(`${this.apiUrl}/runs/${runId}/inputs`);
  }

  /** A bulk replace: the whole set is submitted before calculating. */
  replaceInputs(runId: string, items: PayrollInput[]): Observable<PayrollInput[]> {
    return this.http.put<PayrollInput[]>(`${this.apiUrl}/runs/${runId}/inputs`, { items });
  }

  // ── Payslips ───────────────────────────────────────────────────────────────

  payslips(runId: string): Observable<Payslip[]> {
    return this.http.get<Payslip[]>(`${this.apiUrl}/runs/${runId}/payslips`);
  }

  /** The signed-in person's own payslips, which needs only `payroll:view_own`. */
  myPayslips(): Observable<Payslip[]> {
    return this.http.get<Payslip[]>(`${this.apiUrl}/me/payslips`);
  }

  // ── Concepts ───────────────────────────────────────────────────────────────

  listConcepts(includeInactive = false): Observable<PayrollConcept[]> {
    return this.http.get<PayrollConcept[]>(`${this.apiUrl}/concepts`, {
      params: new HttpParams().set('includeInactive', String(includeInactive)),
    });
  }

  createConcept(body: Partial<PayrollConcept>): Observable<PayrollConcept> {
    return this.http.post<PayrollConcept>(`${this.apiUrl}/concepts`, body);
  }

  updateConcept(id: string, body: Partial<PayrollConcept>): Observable<PayrollConcept> {
    return this.http.patch<PayrollConcept>(`${this.apiUrl}/concepts/${id}`, body);
  }

  removeConcept(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/concepts/${id}`);
  }

  // ── Statutory parameters ───────────────────────────────────────────────────

  listContributions(country = 'DO'): Observable<StatutoryContribution[]> {
    return this.http.get<StatutoryContribution[]>(`${this.apiUrl}/parameters/contributions`, {
      params: new HttpParams().set('country', country),
    });
  }

  listReferences(country = 'DO'): Observable<StatutoryReference[]> {
    return this.http.get<StatutoryReference[]>(`${this.apiUrl}/parameters/references`, {
      params: new HttpParams().set('country', country),
    });
  }

  listBrackets(country = 'DO'): Observable<IncomeTaxBracket[]> {
    return this.http.get<IncomeTaxBracket[]>(`${this.apiUrl}/parameters/tax-brackets`, {
      params: new HttpParams().set('country', country),
    });
  }

  upsertContribution(body: StatutoryContribution): Observable<StatutoryContribution> {
    return this.http.put<StatutoryContribution>(`${this.apiUrl}/parameters/contributions`, body);
  }

  upsertReference(body: StatutoryReference): Observable<StatutoryReference> {
    return this.http.put<StatutoryReference>(`${this.apiUrl}/parameters/references`, body);
  }

  /** The brackets are a set, not rows: a scale is replaced whole, as of a date. */
  replaceTaxScale(body: {
    countryCode: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
    brackets: { lowerAnnual: number; upperAnnual?: number | null; rate: number; accumulatedTax: number }[];
  }): Observable<IncomeTaxBracket[]> {
    return this.http.put<IncomeTaxBracket[]>(`${this.apiUrl}/parameters/tax-brackets`, body);
  }

  // ── TSS filings ────────────────────────────────────────────────────────────

  novedades(year: number, month: number): Observable<unknown> {
    return this.http.get(`${this.apiUrl}/tss/novedades`, {
      params: new HttpParams().set('year', year).set('month', month),
    });
  }

  autodeterminacion(runId: string): Observable<unknown> {
    return this.http.get(`${this.apiUrl}/runs/${runId}/tss/autodeterminacion`);
  }

  /** The SUIR flat file, as text: what gets uploaded to the TSS portal. */
  suir(runId: string): Observable<string> {
    return this.http.get(`${this.apiUrl}/runs/${runId}/tss/suir`, { responseType: 'text' });
  }

  /** What a termination would cost, before anybody commits to it. */
  previewSeverance(
    employeeId: string,
    body: { endDate: string; monthlySalary?: number; ordinarySalaryEarnedThisYear?: number },
  ): Observable<SeverancePreview> {
    return this.http.post<SeverancePreview>(
      `${this.apiUrl}/employees/${employeeId}/severance/preview`,
      body,
    );
  }
}
