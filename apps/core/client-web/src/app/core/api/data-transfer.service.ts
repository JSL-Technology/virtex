import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { readBlobError } from '../http/read-blob-error';

export type DataTransferFormat = 'csv' | 'xlsx';
export type DataTransferStatus = 'COMPLETED' | 'VALIDATED' | 'FAILED' | 'PARTIAL';

export interface DataTransferDataset {
  id: string;
  labelKey: string;
  /** What to know before importing it, when the dataset has rules a template cannot show. */
  hintKey?: string | null;
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

/** Which header of a file is which key, as the server proposes it. */
export interface ColumnMappingProposal {
  headers: string[];
  sample: Array<Record<string, string>>;
  /** Header → dataset key, or null to leave the column out. */
  mapping: Record<string, string | null>;
  /** `template`: the file already uses the keys; `headers`: matched by name; `ai`: the assistant helped. */
  source: 'template' | 'headers' | 'ai';
  /** Required keys no header is mapped to yet. */
  missing: string[];
  columns: Array<{ key: string; required: boolean }>;
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

  /** Propose which header of a file is which key. Imports nothing. */
  columnMapping(dataset: string, file: File): Observable<ColumnMappingProposal> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http.post<ColumnMappingProposal>(`${this.apiUrl}/datasets/${dataset}/column-mapping`, body);
  }

  /** `mapping`, when the file is not the template: the header → key choice the person confirmed. */
  import(dataset: string, file: File, mode: 'validate' | 'commit', mapping?: Record<string, string | null> | null): Observable<ImportReport> {
    const body = new FormData();
    body.append('file', file, file.name);
    if (mapping) body.append('mapping', JSON.stringify(mapping));
    const params = new HttpParams().set('dataset', dataset).set('mode', mode);
    return this.http.post<ImportReport>(`${this.apiUrl}/imports`, body, { params });
  }
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
