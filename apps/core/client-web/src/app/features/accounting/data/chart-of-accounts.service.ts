// app/core/api/chart-of-accounts.service.ts
import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  Account,
  AccountCategory,
  AccountNature,
  AccountType,
  CashFlowCategory,
  RequiredDimension,
} from '../models/account.model';

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

@Injectable({ providedIn: 'root' })
export class ChartOfAccountsApiService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/chart-of-accounts`;

  getAccounts(): Observable<Account[]> {
    return this.http.get<Account[]>(this.apiUrl);
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
