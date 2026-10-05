import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type ExchangeRateType = 'OFFICIAL' | 'MARKET' | 'BUY' | 'SELL';
export const EXCHANGE_RATE_TYPES: readonly ExchangeRateType[] = ['OFFICIAL', 'MARKET', 'BUY', 'SELL'];
export type RateScope = 'TENANT' | 'SHARED' | 'ALL';

/** A rate in the history: the company's own (`TENANT`) or the shared market table (`SHARED`). */
export interface ExchangeRateRow {
  id: string;
  scope: 'TENANT' | 'SHARED';
  fromCurrency: string;
  toCurrency: string;
  /** Units of `toCurrency` for one unit of `fromCurrency`. */
  rate: number;
  date: string;
  rateType: ExchangeRateType;
  source: string;
  recordedByUserId: string | null;
}

export interface RecordRate {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  date: string;
  rateType?: ExchangeRateType;
  source?: string;
}

/** What a document dated `date` would convert at, and how the rate was arrived at. */
export interface ResolvedRate {
  rate: number;
  from: string;
  to: string;
  date: string;
  rateType: ExchangeRateType;
  method: 'IDENTITY' | 'DIRECT' | 'INVERSE' | 'TRIANGULATED';
  via?: string;
  source: string;
  quotedOn: string;
}

export interface RateHistoryQuery {
  currency?: string | null;
  rateType?: ExchangeRateType | null;
  scope?: RateScope | null;
  from?: string | null;
  to?: string | null;
  page?: number;
  limit?: number;
}

export interface RatePage {
  items: ExchangeRateRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/** Exchange rates (audit H-09): the history, recording and importing the company's own, and lookups. */
@Injectable({ providedIn: 'root' })
export class ExchangeRatesService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/exchange-rates`;

  history(query: RateHistoryQuery = {}): Observable<RatePage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<RatePage>(`${this.url}/history`, { params });
  }

  record(rate: RecordRate): Observable<unknown> {
    return this.http.post(this.url, rate);
  }

  importRates(rates: RecordRate[]): Observable<{ imported: number }> {
    return this.http.post<{ imported: number }>(`${this.url}/import`, { rates });
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }

  resolve(from: string, to: string, date: string, rateType?: ExchangeRateType | null): Observable<ResolvedRate> {
    let params = new HttpParams().set('from', from).set('to', to).set('date', date);
    if (rateType) params = params.set('rateType', rateType);
    return this.http.get<ResolvedRate>(this.url, { params });
  }
}

/**
 * Rows of a pasted or uploaded table, one rate each: `date, from, to, rate[, type][, source]`.
 *
 * Comma, semicolon or tab separated — what a spreadsheet exports in either locale — with an
 * optional header row. A decimal comma is read as a decimal point when the separator is not a
 * comma. Returns the rates and, for each line that could not be read, its number.
 */
export function parseRateTable(text: string): { rates: RecordRate[]; invalidLines: number[] } {
  const rates: RecordRate[] = [];
  const invalidLines: number[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const separator = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
    const cells = line.split(separator).map((cell) => cell.trim().replace(/^"|"$/g, ''));
    const [date, from, to, rateText, type, source] = cells;
    const isHeader = index === 0 && !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '');
    if (isHeader) return;
    // With a comma separator the cell cannot hold a comma; otherwise a comma is the decimal mark.
    const rate = Number((rateText ?? '').replace(',', '.'));
    const rateType = (type ?? '').toUpperCase() as ExchangeRateType;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ||
      !/^[A-Za-z]{3}$/.test(from ?? '') ||
      !/^[A-Za-z]{3}$/.test(to ?? '') ||
      !(rate > 0) ||
      (type && !EXCHANGE_RATE_TYPES.includes(rateType))
    ) {
      invalidLines.push(index + 1);
      return;
    }
    rates.push({
      date,
      fromCurrency: from.toUpperCase(),
      toCurrency: to.toUpperCase(),
      rate,
      ...(type ? { rateType } : {}),
      ...(source ? { source } : {}),
    });
  });
  return { rates, invalidLines };
}
