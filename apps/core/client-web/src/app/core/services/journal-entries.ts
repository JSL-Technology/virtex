// app/core/services/journal-entries.ts
import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { JournalEntry } from '../models/journal-entry.model';
import { Page } from '../api/journal-entries.service';

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

  previewImport(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    // The DTO for mapping might be sent as part of the form data as well
    // For now, we just send the file.
    return this.http.post<any>(`${this.apiUrl}/import/preview`, formData);
  }

  confirmImport(batchId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/import/confirm`, { batchId });
  }
}