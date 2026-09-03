import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * The financial statements, as the server computes them.
 *
 * Every figure here comes from posted journal entry lines. Nothing in this file invents, derives
 * or adjusts a number: the statements are the ledger's own arithmetic, and a page that recomputed
 * a subtotal client-side would eventually disagree with the books.
 */

/** An account's own name, in whatever languages the tenant recorded it. */
export type LocalizedName = Record<string, string> | string;

export interface ReportAccountLine {
  accountId: string;
  code: string;
  name: LocalizedName;
  type: string;
  category: string;
  /** In the account's natural sense: revenue and liabilities read positive. */
  amount: number;
}

export interface ReportSection {
  category: string;
  accounts: ReportAccountLine[];
  subtotal: number;
}

export interface LedgerRef {
  id: string;
  name: string;
  currency: string;
}

export interface BalanceSheetReport {
  asOfDate: string;
  ledger: LedgerRef;
  assets: { sections: ReportSection[]; total: number };
  liabilities: { sections: ReportSection[]; total: number };
  equity: { sections: ReportSection[]; unclosedResult: number; total: number };
  totalLiabilitiesAndEquity: number;
  /** Assets against liabilities plus equity. False is a defect in the books, not in the report. */
  isBalanced: boolean;
  outOfBalanceBy: number;
}

export interface IncomeStatementReport {
  period: { startDate: string; endDate: string };
  ledger: LedgerRef;
  revenue: { sections: ReportSection[]; total: number };
  costOfSales: { accounts: ReportAccountLine[]; total: number };
  grossProfit: number;
  operatingExpenses: { accounts: ReportAccountLine[]; total: number };
  operatingIncome: number;
  nonOperating: { accounts: ReportAccountLine[]; total: number };
  netIncome: number;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: LocalizedName;
  type: string;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
}

export interface TrialBalanceReport {
  period: { startDate: string; endDate: string };
  ledger: LedgerRef;
  rows: TrialBalanceRow[];
  totals: {
    openingDebit: number;
    openingCredit: number;
    periodDebit: number;
    periodCredit: number;
    closingDebit: number;
    closingCredit: number;
  };
  isBalanced: boolean;
}

export interface CashFlowMovement {
  accountId: string;
  code: string;
  amount: number;
}

export interface CashFlowStatementReport {
  period: { startDate: string; endDate: string };
  ledger: LedgerRef;
  openingCash: number;
  operating: {
    netIncome: number;
    nonCashAdjustments: CashFlowMovement[];
    workingCapitalChanges: CashFlowMovement[];
    total: number;
  };
  investing: { movements: CashFlowMovement[]; total: number };
  financing: { movements: CashFlowMovement[]; total: number };
  netChangeInCash: number;
  closingCash: number;
  /** Zero by construction: the statement is derived from the movements it explains. */
  unexplainedDifference: number;
}

export interface ReportFilters {
  ledgerId?: string;
  costCenterId?: string;
  projectId?: string;
}

@Injectable({ providedIn: 'root' })
export class FinancialReportingService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/financial-reporting`;

  balanceSheet(asOfDate: string, filters: ReportFilters = {}): Observable<BalanceSheetReport> {
    return this.http.get<BalanceSheetReport>(`${this.apiUrl}/balance-sheet`, {
      params: this.toParams({ asOfDate, ...filters }),
    });
  }

  incomeStatement(
    startDate: string,
    endDate: string,
    filters: ReportFilters = {},
  ): Observable<IncomeStatementReport> {
    return this.http.get<IncomeStatementReport>(`${this.apiUrl}/income-statement`, {
      params: this.toParams({ startDate, endDate, ...filters }),
    });
  }

  trialBalance(
    startDate: string,
    endDate: string,
    ledgerId?: string,
  ): Observable<TrialBalanceReport> {
    return this.http.get<TrialBalanceReport>(`${this.apiUrl}/trial-balance`, {
      params: this.toParams({ startDate, endDate, ledgerId }),
    });
  }

  cashFlowStatement(
    startDate: string,
    endDate: string,
    ledgerId?: string,
  ): Observable<CashFlowStatementReport> {
    return this.http.get<CashFlowStatementReport>(`${this.apiUrl}/cash-flow-statement`, {
      params: this.toParams({ startDate, endDate, ledgerId }),
    });
  }

  private toParams(values: Record<string, string | undefined>): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(values)) {
      if (value) params = params.set(key, value);
    }
    return params;
  }
}
