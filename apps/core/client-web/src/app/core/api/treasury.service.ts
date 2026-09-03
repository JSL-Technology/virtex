import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Mirrors `BankAccountType` on the server. */
export type BankAccountType = 'CHECKING' | 'SAVINGS' | 'CASH' | 'CREDIT_CARD';

export interface BankAccount {
  id: string;
  name: string;
  bankName: string | null;
  /**
   * The full number, returned only by the bank-account endpoints, which a reconciliation needs in
   * order to match a statement header. The cash position sends a masked one instead.
   */
  accountNumber: string | null;
  iban: string | null;
  swiftBic: string | null;
  accountType: BankAccountType;
  currencyCode: string;
  glAccountId: string;
  openingBalance: number;
  openingDate: string | null;
  isActive: boolean;
  notes: string | null;
}

export interface CashPositionRow {
  bankAccountId: string;
  name: string;
  bankName: string | null;
  /** Only the last four digits leave the server. */
  accountNumberMasked: string | null;
  currencyCode: string;
  glAccountId: string;
  balanceInBaseCurrency: number;
}

export interface CashPosition {
  asOfDate: string;
  baseCurrency: string;
  accounts: CashPositionRow[];
  total: number;
}

export interface BankTransfer {
  id: string;
  date: string;
  amount: number;
  amountReceived: number;
  fee: number;
  fromBankAccountId: string;
  toBankAccountId: string;
  description: string;
  reference: string | null;
  journalEntryId: string | null;
}

export interface CreateBankTransfer {
  date: string;
  amount: number;
  fromBankAccountId: string;
  toBankAccountId: string;
  amountReceived?: number;
  fee?: number;
  description: string;
  reference?: string;
}

@Injectable({ providedIn: 'root' })
export class TreasuryService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/treasury`;

  listBankAccounts(): Observable<BankAccount[]> {
    return this.http.get<BankAccount[]>(`${this.apiUrl}/bank-accounts`);
  }

  cashPosition(asOfDate?: string): Observable<CashPosition> {
    const params = asOfDate ? new HttpParams().set('asOfDate', asOfDate) : undefined;
    return this.http.get<CashPosition>(`${this.apiUrl}/cash-position`, { params });
  }

  listTransfers(): Observable<BankTransfer[]> {
    return this.http.get<BankTransfer[]>(`${this.apiUrl}/bank-transfers`);
  }

  createTransfer(body: CreateBankTransfer): Observable<BankTransfer> {
    return this.http.post<BankTransfer>(`${this.apiUrl}/bank-transfers`, body);
  }
}
