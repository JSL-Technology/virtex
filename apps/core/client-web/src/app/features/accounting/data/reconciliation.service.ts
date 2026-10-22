import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

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

/**
 * What an import can leave out depends on the file. An OFX or camt.053 file states its dates,
 * amounts and (usually) its balances, so only the account is needed; a CSV needs its columns named.
 * A period or balance given alongside a file that states its own must agree with it.
 */
export interface ImportStatementOptions {
  bankAccountId: string;
  startDate?: string;
  endDate?: string;
  startingBalance?: number | null;
  endingBalance?: number | null;
  dateColumn?: string;
  descriptionColumn?: string;
  referenceColumn?: string;
  debitColumn?: string;
  creditColumn?: string;
  amountColumn?: string;
  /** `date-fns` tokens: `dd/MM/yyyy`, `MM/dd/yyyy`, `yyyy-MM-dd`. */
  dateFormat?: string;
  decimalSeparator?: '.' | ',';
  positiveAmountIsMoneyIn?: boolean;
}

export type BankFileFormat = 'csv' | 'ofx' | 'camt053';

/** Which column of a CSV is which, as the server proposes it. Column names, never values. */
export interface ProposedColumnMapping {
  date: string | null;
  description: string | null;
  reference: string | null;
  moneyIn: string | null;
  moneyOut: string | null;
  amount: string | null;
  dateFormat: string | null;
  decimalSeparator: '.' | ',';
  positiveAmountIsMoneyIn: boolean;
}

export interface ColumnMappingProposal {
  format: BankFileFormat;
  headers: string[];
  sample: Array<Record<string, string>>;
  mapping: ProposedColumnMapping | null;
  /** `not_needed`: OFX/camt; `headers`: read from the names; `ai`: proposed by the assistant. */
  source: 'not_needed' | 'headers' | 'ai' | 'incomplete';
  /** What still has to be chosen by hand: `date`, `description`, `amount`, `dateFormat`, `numbers:<column>`. */
  problems: string[];
}

/** Why a candidate scored what it did. */
export type MatchReason = 'amount' | 'same_day' | 'near_date' | 'reference' | 'words' | 'learned';

/**
 * `safe`: one clear candidate above the company's threshold, not claimed by another line.
 * `review`: candidates a person should choose between. `none`: nothing in the ledger fits.
 */
export type SuggestionConfidence = 'safe' | 'review' | 'none';

export interface ReconciliationSettings {
  autoConfirm: boolean;
  minScore: number;
}

export interface AmbiguityResolution {
  chosenId: string | null;
  reason: string;
}

export interface MatchCandidate {
  journalEntryLineId: string;
  journalEntryId: string;
  entryNumber: string | null;
  date: string;
  description: string | null;
  amount: number;
  score: number;
  reasons: MatchReason[];
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
  confidence: SuggestionConfidence;
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

/** One bank account's settings in effect, with the threshold calibrated from what people undid. */
export interface AccountReconciliationSettings {
  bankAccountId: string;
  autoConfirm: boolean;
  configuredMinScore: number;
  /** The score a match needs now, for this account, after calibration. */
  minScore: number;
  /** Share of the matches confirmed without a person that people kept; null without history. */
  precision: number | null;
  samples: number;
  paused: boolean;
  pausedAt: string | null;
  pausedReason: string | null;
  inherits: { autoConfirm: boolean; minScore: boolean };
}

/** The account an unexplained bank line most likely belongs to, learned from the company's history. */
export interface CategorySuggestion {
  bankTransactionId: string;
  accountId: string;
  accountCode: string;
  accountName: string | Record<string, string>;
  probability: number;
  support: number;
  evidence: string[];
}

@Injectable({ providedIn: 'root' })
export class ReconciliationApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/reconciliation`;

  /**
   * Import a statement.
   *
   * Sent as multipart because a CSV travels with its column mapping: which column holds the
   * date, how that bank writes one, and whether `1.234,56` means a thousand or one and a bit. The
   * importer refuses a file it cannot read rather than guessing. OFX and camt.053 need none of it.
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

  /** Propose which column is which (or say the file needs no mapping). Imports nothing. */
  columnMapping(file: File): Observable<ColumnMappingProposal> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http.post<ColumnMappingProposal>(`${this.apiUrl}/column-mapping`, body);
  }

  settings(): Observable<ReconciliationSettings> {
    return this.http.get<ReconciliationSettings>(`${this.apiUrl}/settings`);
  }

  updateSettings(changes: Partial<ReconciliationSettings>): Observable<ReconciliationSettings> {
    return this.http.patch<ReconciliationSettings>(`${this.apiUrl}/settings`, changes);
  }

  accountSettings(bankAccountId: string): Observable<AccountReconciliationSettings> {
    return this.http.get<AccountReconciliationSettings>(`${this.apiUrl}/bank-accounts/${bankAccountId}/settings`);
  }

  updateAccountSettings(
    bankAccountId: string,
    changes: { autoConfirm?: boolean | null; minScore?: number | null; resume?: boolean },
  ): Observable<AccountReconciliationSettings> {
    return this.http.patch<AccountReconciliationSettings>(`${this.apiUrl}/bank-accounts/${bankAccountId}/settings`, changes);
  }

  /** Undo every match of the statement confirmed without a person. */
  undoAutomatic(id: string): Observable<{ undone: number }> {
    return this.http.post<{ undone: number }>(`${this.apiUrl}/statements/${id}/undo-automatic`, {});
  }

  categories(id: string): Observable<CategorySuggestion[]> {
    return this.http.get<CategorySuggestion[]>(`${this.apiUrl}/statements/${id}/categories`);
  }

  /** Book an unexplained bank line to an account (the entry the books were missing) and match it. */
  categorize(id: string, transactionId: string, accountId: string): Observable<{ matchId: string }> {
    return this.http.post<{ matchId: string }>(`${this.apiUrl}/statements/${id}/transactions/${transactionId}/categorize`, { accountId });
  }

  /** Confirm every `safe` suggestion of the statement at once. */
  applySafe(id: string): Observable<{ applied: number }> {
    return this.http.post<{ applied: number }>(`${this.apiUrl}/statements/${id}/apply-safe`, {});
  }

  /** Ask the assistant which of several candidates a statement line is, and why. Matches nothing. */
  resolve(statementId: string, transactionId: string): Observable<AmbiguityResolution> {
    return this.http.post<AmbiguityResolution>(
      `${this.apiUrl}/statements/${statementId}/transactions/${transactionId}/resolve`,
      {},
    );
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
