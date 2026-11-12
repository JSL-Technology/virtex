import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable, catchError, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { readBlobError } from '../../../core/http/read-blob-error';

export type FilingStatus = 'GENERATED' | 'SUBMITTED';

/** One month's return, as the server's filing calendar records it. */
export interface FiscalReturnFiling {
  kind: string;
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

/** Something the authority asks for beyond the period, as its market declares it. */
export interface ReturnFilingOption {
  name: string;
  labelKey: string;
  kind: 'TEXT' | 'DATE' | 'CHOICE';
  values?: readonly string[];
  required: boolean;
}

/**
 * One return this company's market files.
 *
 * The screen used to carry the list itself — the four Dominican formats and the three Mexican
 * documents, with a branch per country — so a market the product gained filed nothing until the
 * client was edited too (docs/ARQUITECTURA_MERCADOS.md, fase 5).
 */
export interface ReturnFiling {
  code: string;
  labelKey: string;
  periodicity: 'MONTHLY' | 'ON_REQUEST';
  mediaType: string;
  extension: string;
  /** Whether the filing calendar tracks it month by month. */
  tracked: boolean;
  options: readonly ReturnFilingOption[];
}

/** A downloaded return: the file and the name the authority's own convention gives it. */
export interface DownloadedReturn {
  blob: Blob;
  fileName: string;
}

/**
 * The periodic fiscal returns (audit H-08): the files themselves, and the calendar of which months
 * were generated and filed.
 */
@Injectable({ providedIn: 'root' })
export class FiscalReturnsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/compliance`;

  /** What this company's market files, with what each one asks for. */
  available(): Observable<ReturnFiling[]> {
    return this.http.get<ReturnFiling[]>(`${this.base}/returns`);
  }

  /** The first day the company had anything to report (QA A-15): where the calendar starts. */
  activeSince(): Observable<{ activeSince: string }> {
    return this.http.get<{ activeSince: string }>(`${this.base}/filings/active-since`);
  }

  filings(year: number): Observable<FiscalReturnFiling[]> {
    return this.http.get<FiscalReturnFiling[]>(`${this.base}/filings`, { params: { year } });
  }

  /**
   * The file, as the authority receives it. Downloading it records a generation.
   *
   * The options the filing declared travel as `name:value` pairs, and the name of the file comes
   * back with it: how a return is called is its authority's convention, not something to rebuild
   * here from the code and the period.
   */
  download(
    code: string,
    year: number,
    month: number,
    options: Readonly<Record<string, string>> = {},
  ): Observable<DownloadedReturn> {
    let params = new HttpParams().set('year', year).set('month', month);
    for (const [name, value] of Object.entries(options)) {
      if (value) params = params.append('option', `${name}:${value}`);
    }
    return this.http
      .get(`${this.base}/returns/${code}`, { params, responseType: 'blob', observe: 'response' })
      .pipe(
        map((response: HttpResponse<Blob>) => ({
          blob: response.body as Blob,
          fileName: fileNameOf(response.headers.get('content-disposition')) ?? `${code}-${year}-${month}`,
        })),
        // A refused file — a 606 naming the suppliers without a tax id — answers with JSON in a Blob.
        catchError(readBlobError),
      );
  }

  /** Generate without downloading: the record count, and whether it still matches the filing. */
  check(kind: string, year: number, month: number): Observable<FiscalReturnFiling> {
    return this.http.post<FiscalReturnFiling>(`${this.base}/filings/${kind}/${year}/${month}/check`, {});
  }

  markSubmitted(kind: string, year: number, month: number, reference: string): Observable<FiscalReturnFiling> {
    return this.http.post<FiscalReturnFiling>(`${this.base}/filings/${kind}/${year}/${month}/submission`, { reference });
  }

  clearSubmission(kind: string, year: number, month: number): Observable<FiscalReturnFiling> {
    return this.http.delete<FiscalReturnFiling>(`${this.base}/filings/${kind}/${year}/${month}/submission`);
  }
}

/** `attachment; filename="DGII_607_202608.txt"` → the name. */
function fileNameOf(header: string | null): string | null {
  const match = /filename="?([^"]+)"?/.exec(header ?? '');
  return match ? match[1] : null;
}
