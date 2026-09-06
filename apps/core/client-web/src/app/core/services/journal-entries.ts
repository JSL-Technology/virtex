// app/core/services/journal-entries.ts
import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { JournalEntry } from '../models/journal-entry.model';
import { Page } from '../api/journal-entries.service';

/** Which column of the file holds which field. */
export interface ImportColumnMapping {
  entryId: string;
  date: string;
  description: string;
  accountCode: string;
  debit: string;
  credit: string;
  lineDescription?: string;
}

export interface ImportMapping {
  columnMapping: ImportColumnMapping;
  /** `date-fns` tokens: `dd/MM/yyyy` reads 03/04 as 3 April, `MM/dd/yyyy` as 4 March. */
  dateFormat: string;
  /** `,` for `1.234,56`, `.` for `1,234.56`. */
  decimalSeparator: '.' | ',';
}

/** Why one row or one entry cannot be posted: a message key and its parameters, not a sentence. */
export interface ImportError {
  messageKey: string;
  params?: Record<string, string | number>;
}

export interface ImportPreviewRow {
  lineNumber: number;
  isValid: boolean;
  error?: ImportError;
  data: Record<string, string>;
}

export interface ImportPreviewEntry {
  entryId: string;
  isBalanced: boolean;
  totalDebit: number;
  totalCredit: number;
  errors: ImportError[];
  rows: ImportPreviewRow[];
}

export interface ImportPreview {
  batchId: string;
  totalEntries: number;
  validEntriesCount: number;
  invalidEntriesCount: number;
  previews: ImportPreviewEntry[];
}

export interface ImportConfirmation {
  messageKey: string;
  createdEntriesCount: number;
}

// Usaremos un DTO (Data Transfer Object) para la creación,
// ya que no necesitamos enviar todos los campos de JournalEntry.
type CreateJournalEntryDto = Omit<JournalEntry, 'id' | 'organizationId' | 'createdAt' | 'updatedAt' | 'totalDebit' | 'totalCredit' | 'status'>;


@Injectable({
  providedIn: 'root'
})
export class JournalEntries {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/journal-entries`;

  /** A page of entries. The route is bounded; see `JournalEntriesApiService.list`. */
  getAll(query: { page?: number; pageSize?: number } = {}): Observable<Page<JournalEntry>> {
    let params = new HttpParams();
    if (query.page) params = params.set('page', String(query.page));
    if (query.pageSize) params = params.set('pageSize', String(query.pageSize));
    return this.http.get<Page<JournalEntry>>(this.apiUrl, { params });
  }

  getById(id: string): Observable<JournalEntry> {
    return this.http.get<JournalEntry>(`${this.apiUrl}/${id}`);
  }

  create(entry: CreateJournalEntryDto): Observable<JournalEntry> {
    return this.http.post<JournalEntry>(this.apiUrl, entry);
  }

  /**
   * The file's column names, so the user can say which is which.
   *
   * There was no such call, and no mapping step: `previewImport` posted the file with the comment
   * "For now, we just send the file". The server requires `columnMapping`, so every preview came
   * back 400 and the screen showed its own generic failure message. The import was unreachable
   * from the product.
   */
  importHeaders(file: File): Observable<string[]> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return this.http.post<string[]>(`${this.apiUrl}/import/headers`, formData);
  }

  previewImport(file: File, mapping: ImportMapping): Observable<ImportPreview> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    // Multipart has no types, so the nested mapping travels as JSON and the server's file
    // interceptor parses it back out.
    formData.append('columnMapping', JSON.stringify(mapping.columnMapping));
    formData.append('dateFormat', mapping.dateFormat);
    formData.append('decimalSeparator', mapping.decimalSeparator);
    return this.http.post<ImportPreview>(`${this.apiUrl}/import/preview`, formData);
  }

  confirmImport(batchId: string): Observable<ImportConfirmation> {
    return this.http.post<ImportConfirmation>(`${this.apiUrl}/import/confirm`, { batchId });
  }
}