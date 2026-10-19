import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { readBlobError } from '../../../core/http/read-blob-error';

/** The Dominican Republic's monthly «formatos de envío». */
export const DGII_RETURNS = ['606', '607', '608', '609'] as const;
/** Mexico's monthly electronic-accounting documents. The Pólizas file is answered on request. */
export const SAT_MONTHLY_RETURNS = ['catalogo', 'balanza'] as const;

export type DgiiReturn = (typeof DGII_RETURNS)[number];
export type SatMonthlyReturn = (typeof SAT_MONTHLY_RETURNS)[number];
export type TrackedReturn = DgiiReturn | SatMonthlyReturn;

export type FilingStatus = 'GENERATED' | 'SUBMITTED';

/** One month's return, as the server's filing calendar records it. */
export interface FiscalReturnFiling {
  kind: TrackedReturn;
  year: number;
  month: number;
  status: FilingStatus;
  recordCount: number;
  lastHash: string;
  lastGeneratedAt: string;
  submittedRecordCount: number | null;
  submittedAt: string | null;
  submissionReference: string | null;
  changedSinceSubmission: boolean;
}

/** The parameters of a SAT document beyond its period. */
export interface SatDocumentOptions {
  /** Balanza: `N` ordinary, `C` complementary (correcting a filed one). */
  tipoEnvio?: 'N' | 'C';
  /** Balanza complementaria: the day the balances were modified, `YYYY-MM-DD`. */
  fechaModBal?: string;
  /** Pólizas: `AF` acto de fiscalización, `FC` fiscalización compulsa, `DE` devolución, `CO` compensación. */
  tipoSolicitud?: 'AF' | 'FC' | 'DE' | 'CO';
  numOrden?: string;
  numTramite?: string;
}

export function isDgiiReturn(kind: string): kind is DgiiReturn {
  return (DGII_RETURNS as readonly string[]).includes(kind);
}

/** The file name the download is saved under: the authority's own prefix and the period. */
export function returnFileName(kind: string, year: number, month: number): string {
  const period = `${year}${String(month).padStart(2, '0')}`;
  return isDgiiReturn(kind) ? `DGII_${kind}_${period}.txt` : `SAT_${kind}_${period}.xml`;
}

/**
 * The periodic fiscal returns (audit H-08): the files themselves, and the calendar of which months
 * were generated and filed.
 */
@Injectable({ providedIn: 'root' })
export class FiscalReturnsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/compliance`;

  /** The first day the company had anything to report (QA A-15): where the calendar starts. */
  activeSince(): Observable<{ activeSince: string }> {
    return this.http.get<{ activeSince: string }>(`${this.base}/filings/active-since`);
  }

  filings(year: number): Observable<FiscalReturnFiling[]> {
    return this.http.get<FiscalReturnFiling[]>(`${this.base}/filings`, { params: { year } });
  }

  /** The file, as the authority receives it. Downloading it records a generation. */
  download(kind: string, year: number, month: number, options: SatDocumentOptions = {}): Observable<Blob> {
    let params = new HttpParams().set('year', year).set('month', month);
    if (!isDgiiReturn(kind)) {
      for (const [key, value] of Object.entries(options)) {
        if (value) params = params.set(key, value);
      }
    }
    const url = isDgiiReturn(kind) ? `${this.base}/reports/${kind}` : `${this.base}/mx/electronic-accounting/${kind}`;
    // A refused file — a 606 naming the suppliers without an RNC — answers with JSON in a Blob.
    return this.http.get(url, { params, responseType: 'blob' }).pipe(catchError(readBlobError));
  }

  /** Generate without downloading: the record count, and whether it still matches the filing. */
  check(kind: TrackedReturn, year: number, month: number): Observable<FiscalReturnFiling> {
    return this.http.post<FiscalReturnFiling>(`${this.base}/filings/${kind}/${year}/${month}/check`, {});
  }

  markSubmitted(kind: TrackedReturn, year: number, month: number, reference: string): Observable<FiscalReturnFiling> {
    return this.http.post<FiscalReturnFiling>(`${this.base}/filings/${kind}/${year}/${month}/submission`, { reference });
  }

  clearSubmission(kind: TrackedReturn, year: number, month: number): Observable<FiscalReturnFiling> {
    return this.http.delete<FiscalReturnFiling>(`${this.base}/filings/${kind}/${year}/${month}/submission`);
  }
}
