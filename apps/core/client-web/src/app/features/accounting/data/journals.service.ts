import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Journal } from '../models/journal.model';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class JournalsService {
  private http = inject(HttpClient);
//   private apiUrl = '/api/journals';
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

  update(id: string, journal: Journal): Observable<Journal> {
    return this.http.put<Journal>(`${this.apiUrl}/${id}`, journal);
  }

  
}