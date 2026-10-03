import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Journal } from '../../../core/models/journal.model';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class JournalsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/journals`;

  getJournals(): Observable<Journal[]> {
    return this.http.get<Journal[]>(this.apiUrl);
  }

  getJournalById(id: string): Observable<Journal> {
    return this.http.get<Journal>(`${this.apiUrl}/${id}`);
  }

  create(journal: Journal): Observable<Journal> {
    return this.http.post<Journal>(this.apiUrl, journal);
  }

  update(id: string, journal: Partial<Pick<Journal, 'name' | 'code' | 'type'>>): Observable<Journal> {
    return this.http.patch<Journal>(`${this.apiUrl}/${id}`, journal);
  }

  /** Only a journal nothing was posted to, and never one the product posts to itself. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}