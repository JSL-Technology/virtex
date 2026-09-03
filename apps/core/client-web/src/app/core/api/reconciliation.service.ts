import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type StatementStatus = 'IMPORTING' | 'IMPORTED' | 'FAILED' | 'RECONCILED';
export type TransactionStatus = 'UNMATCHED' | 'MATCHED' | 'EXCLUDED';

export interface BankTransaction {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  /** Money into the account. */
  debit: number;
  /** Money out of it. */
  credit: number;
  status: TransactionStatus;
  matchId: string | null;
  exclusionReason: string | null;
  sourceRow: number | null;
}

export interface BankStatement {
  id: string;
  bankAccountId: string;
  fileName: string;
  startDate: string;
  endDate: string;
  startingBalance: number;
  endingBalance: number;
  status: StatementStatus;
  importError: string | null;
  reconciledAt: string | null;
  transactions?: BankTransaction[];
}

export interface ImportStatementOptions {
  bankAccountId: string;
  startDate: string;
  endDate: string;
  startingBalance: number;
  endingBalance: number;
  dateColumn: string;
  descriptionColumn: string;
  referenceColumn?: string;
  debitColumn?: string;
  creditColumn?: string;
  amountColumn?: string;
  /** `date-fns` tokens: `dd/MM/yyyy`, `MM/dd/yyyy`, `yyyy-MM-dd`. */
  dateFormat: string;
  decimalSeparator?: '.' | ',';
  positiveAmountIsMoneyIn?: boolean;
}

export interface MatchCandidate {
  journalEntryLineId: string;
  journalEntryId: string;
  entryNumber: string | null;
  date: string;
  description: string | null;
  amount: number;
  score: number;
}

export interface MatchCandidateGroup {
  journalEntryLineIds: string[];
  amount: number;
  score: number;
}

export interface TransactionSuggestion {
  bankTransactionId: string;
  date: string;
  description: string;
  amount: number;
  candidates: MatchCandidate[];
  candidateGroups: MatchCandidateGroup[];
  suggestedRuleId: string | null;
}

/**
 * The proof a reconciliation exists to produce.
 *
 * Two adjusted balances that must meet: what the books say plus the bank movements they have not
 * recorded, against what the bank says plus the ledger items it has not seen. `difference` is what
 * closing the statement requires at zero.
 */
export interface ReconciliationSummary {
  statementId: string;
  bankAccountId: string;
  startDate: string;
  endDate: string;
  status: StatementStatus;
  statementEndingBalance: number;
  bookBalance: number;
  outstandingLedgerAmount: number;
  outstandingLedgerCount: number;
  unrecordedStatementAmount: number;
  unrecordedStatementCount: number;
  adjustedBankBalance: number;
  adjustedBookBalance: number;
  difference: number;
  isReconciled: boolean;
  statementIsInternallyConsistent: boolean;
  statementInternalDifference: number;
}

export interface ReconciliationMatch {
  id: string;
  statementId: string;
  amount: number;
  origin: 'MANUAL' | 'RULE' | 'AUTOMATIC';
  ruleId: string | null;
  notes: string | null;
}

@Injectable({ providedIn: 'root' })
export class ReconciliationApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/reconciliation`;

  /**
   * Import a statement.
   *
   * Sent as multipart because the CSV travels with its column mapping: which column holds the
   * date, how that bank writes one, and whether `1.234,56` means a thousand or one and a bit. The
   * importer refuses a file it cannot read rather than guessing, so every one of these is required
   * to be right.
   */
  importStatement(file: File, options: ImportStatementOptions): Observable<BankStatement> {
    const body = new FormData();
    body.append('file', file, file.name);
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined && value !== null && value !== '') {
        body.append(key, String(value));
      }
    }
    return this.http.post<BankStatement>(`${this.apiUrl}/statements`, body);
  }

  listStatements(bankAccountId?: string): Observable<BankStatement[]> {
    const params = bankAccountId
      ? new HttpParams().set('bankAccountId', bankAccountId)
      : undefined;
    return this.http.get<BankStatement[]>(`${this.apiUrl}/statements`, { params });
  }

  findStatement(id: string): Observable<BankStatement> {
    return this.http.get<BankStatement>(`${this.apiUrl}/statements/${id}`);
  }

  summary(id: string): Observable<ReconciliationSummary> {
    return this.http.get<ReconciliationSummary>(`${this.apiUrl}/statements/${id}/summary`);
  }

  suggestions(id: string): Observable<TransactionSuggestion[]> {
    return this.http.get<TransactionSuggestion[]>(`${this.apiUrl}/statements/${id}/suggestions`);
  }

  applyRules(id: string): Observable<{ matched: number; created: number }> {
    return this.http.post<{ matched: number; created: number }>(
      `${this.apiUrl}/statements/${id}/apply-rules`,
      {},
    );
  }

  close(id: string): Observable<BankStatement> {
    return this.http.post<BankStatement>(`${this.apiUrl}/statements/${id}/close`, {});
  }

  reopen(id: string): Observable<BankStatement> {
    return this.http.post<BankStatement>(`${this.apiUrl}/statements/${id}/reopen`, {});
  }

  confirmMatch(body: {
    statementId: string;
    bankTransactionIds: string[];
    journalEntryLineIds: string[];
    notes?: string;
  }): Observable<ReconciliationMatch> {
    return this.http.post<ReconciliationMatch>(`${this.apiUrl}/matches`, body);
  }

  unmatch(matchId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/matches/${matchId}`);
  }

  exclude(transactionId: string, reason: string): Observable<BankTransaction> {
    return this.http.post<BankTransaction>(
      `${this.apiUrl}/transactions/${transactionId}/exclude`,
      { reason },
    );
  }
}
