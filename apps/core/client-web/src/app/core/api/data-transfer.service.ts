import { HttpClient, HttpErrorResponse, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, from, map, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';

export type DataTransferFormat = 'csv' | 'xlsx';
export type DataTransferStatus = 'COMPLETED' | 'VALIDATED' | 'FAILED' | 'PARTIAL';

export interface DataTransferDataset {
  id: string;
  labelKey: string;
  importable: boolean;
  columns: Array<{ key: string; required: boolean }>;
}

/** A row-level problem, in the API's error contract (`key` + `params`). */
export interface DataTransferProblem {
  row: number;
  column?: string;
  key: string;
  params: Record<string, unknown>;
}

export interface DataTransferRun {
  id: string;
  kind: 'EXPORT' | 'IMPORT';
  dataset: string;
  format: DataTransferFormat;
  fileName: string | null;
  status: DataTransferStatus;
  totalRows: number;
  importedRows: number;
  failedRows: number;
  problems: DataTransferProblem[];
  userName: string | null;
  createdAt: string;
}

export interface ImportReport {
  runId: string;
  status: DataTransferStatus;
  totalRows: number;
  importedRows: number;
  failedRows: number;
  problems: DataTransferProblem[];
}

export interface DownloadedFile {
  fileName: string;
  blob: Blob;
}

/** Export and import of the datasets the API offers (QA A-10). */
@Injectable({ providedIn: 'root' })
export class DataTransferService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/data-transfer`;

  datasets(): Observable<DataTransferDataset[]> {
    return this.http.get<DataTransferDataset[]>(`${this.apiUrl}/datasets`);
  }

  runs(kind: 'EXPORT' | 'IMPORT'): Observable<DataTransferRun[]> {
    return this.http.get<DataTransferRun[]>(`${this.apiUrl}/runs`, { params: { kind } });
  }

  export(dataset: string, format: DataTransferFormat): Observable<DownloadedFile> {
    return this.http
      .post(`${this.apiUrl}/exports`, { dataset, format }, { observe: 'response', responseType: 'blob' })
      .pipe(
        map((response) => toFile(response, `${dataset}.${format}`)),
        catchError(readBlobError),
      );
  }

  template(dataset: string): Observable<DownloadedFile> {
    return this.http
      .get(`${this.apiUrl}/datasets/${encodeURIComponent(dataset)}/template`, {
        observe: 'response',
        responseType: 'blob',
      })
      .pipe(
        map((response) => toFile(response, `${dataset}_plantilla.csv`)),
        catchError(readBlobError),
      );
  }

  import(dataset: string, file: File, mode: 'validate' | 'commit'): Observable<ImportReport> {
    const body = new FormData();
    body.append('file', file, file.name);
    const params = new HttpParams().set('dataset', dataset).set('mode', mode);
    return this.http.post<ImportReport>(`${this.apiUrl}/imports`, body, { params });
  }
}

/**
 * A refused download answers with JSON, but a `responseType: 'blob'` request receives it as a Blob,
 * and `{code, messageKey}` would be invisible to the error handler: the reader would get a generic
 * failure instead of «no tienes permiso» or «demasiadas filas». The body is read back into JSON.
 */
function readBlobError(error: unknown): Observable<never> {
  if (!(error instanceof HttpErrorResponse) || !(error.error instanceof Blob)) return throwError(() => error);
  return from(error.error.text()).pipe(
    switchMap((text) => {
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // Not JSON: keep the text; the handler falls back to the status.
      }
      return throwError(
        () =>
          new HttpErrorResponse({
            error: body,
            headers: error.headers,
            status: error.status,
            statusText: error.statusText,
            url: error.url ?? undefined,
          }),
      );
    }),
  );
}

function toFile(response: HttpResponse<Blob>, fallback: string): DownloadedFile {
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return { fileName: match?.[1] ?? fallback, blob: response.body ?? new Blob() };
}

/** Hands a downloaded file to the browser. */
export function saveFile({ fileName, blob }: DownloadedFile): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
