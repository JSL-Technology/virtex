// app/core/api/chart-of-accounts.service.ts
import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  Account,
  AccountCategory,
  AccountNature,
  AccountType,
  CashFlowCategory,
  RequiredDimension,
} from '../../../core/models/account.model';

export interface CreateAccountDto {
  segments: string[];
  name: string;
  description?: string;
  parentId?: string | null;
  type: AccountType;
  category: AccountCategory;
  nature: AccountNature;
  isPostable?: boolean;
  isActive?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
  statementMapping?: {
    balanceSheetCategory?: string;
    incomeStatementCategory?: string;
    cashFlowCategory?: CashFlowCategory;
  };
  rules?: {
    requiresReconciliation?: boolean;
    isCashOrBank?: boolean;
    allowsIntercompany?: boolean;
    isFxRevaluation?: boolean;
    requiredDimensions?: RequiredDimension[];
  };
}

export type UpdateAccountDto = Partial<CreateAccountDto>;

export interface AccountSegmentDefinition {
  id?: string;
  name: string;
  length: number;
  isRequired: boolean;
  order?: number;
}

export interface ConfigureAccountSegmentsDto {
  segments: AccountSegmentDefinition[];
}

export interface MergePreviewAccount {
  id: string;
  code: string;
  name: Record<string, string>;
  type: string;
  /** Posted debit − credit, base currency. */
  postedBalance: number;
}

/** What merging one account into another would move, from the tenant's own ledger. */
export interface MergePreview {
  source: MergePreviewAccount;
  destination: MergePreviewAccount;
  linesToMove: number;
  linesInClosedPeriods: number;
  childAccountsToMove: number;
  /** Translation keys of every reason the server would refuse the merge. */
  blockers: string[];
  /** Translation keys of consequences to accept knowingly. */
  warnings: string[];
}

export interface MergeStarted {
  jobId: string;
  messageKey: string;
  messageParams: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class ChartOfAccountsApiService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/chart-of-accounts`;

  getAccounts(): Observable<Account[]> {
    return this.http.get<Account[]>(this.apiUrl);
  }

  /**
   * Las cuentas que coinciden con `search`, como mucho `limit`.
   *
   * Para los selectores de cuenta. `getAccounts()` se trae el plan entero —en una empresa real,
   * cerca de mil cuentas con su padre y sus segmentos cargados—, que es lo correcto para la
   * pantalla que los LISTA y lo que no escala para un campo que enseña diez a la vez.
   */
  searchAccounts(search: string, limit: number): Observable<Account[]> {
    let params = new HttpParams().set('limit', limit);
    if (search.trim()) params = params.set('search', search.trim());
    return this.http.get<Account[]>(this.apiUrl, { params });
  }
  
  previewMerge(sourceAccountId: string, destinationAccountId: string): Observable<MergePreview> {
    const params = new HttpParams()
      .set('sourceAccountId', sourceAccountId)
      .set('destinationAccountId', destinationAccountId);
    return this.http.get<MergePreview>(`${this.apiUrl}/merge/preview`, { params });
  }

  /** Queues the merge; it runs as a background job that reports through the jobs panel. */
  merge(sourceAccountId: string, destinationAccountId: string, reason: string): Observable<MergeStarted> {
    return this.http.post<MergeStarted>(`${this.apiUrl}/merge`, { sourceAccountId, destinationAccountId, reason });
  }

  getAccountTree(): Observable<Account[]> {
    return this.http.get<Account[]>(`${this.apiUrl}/tree`);
  }

  getAccountById(id: string): Observable<Account> {
    return this.http.get<Account>(`${this.apiUrl}/${id}`);
  }

  createAccount(account: CreateAccountDto): Observable<Account> {
    return this.http.post<Account>(this.apiUrl, account);
  }

  updateAccount(id: string, account: UpdateAccountDto): Observable<Account> {
    return this.http.patch<Account>(`${this.apiUrl}/${id}`, account);
  }

  deleteAccount(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  getSegmentDefinitions(): Observable<AccountSegmentDefinition[]> {
    return this.http.get<AccountSegmentDefinition[]>(`${this.apiUrl}/segment-definitions`);
  }

  configureSegmentDefinitions(dto: ConfigureAccountSegmentsDto): Observable<AccountSegmentDefinition[]> {
    return this.http.post<AccountSegmentDefinition[]>(`${this.apiUrl}/segment-definitions`, dto);
  }

  initializeDefaultSegments(): Observable<AccountSegmentDefinition[]> {
    return this.http.post<AccountSegmentDefinition[]>(`${this.apiUrl}/segment-definitions/initialize`, {});
  }
}
