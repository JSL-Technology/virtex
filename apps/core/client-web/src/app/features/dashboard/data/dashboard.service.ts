// app/core/api/dashboard.service.ts
import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface QuickRatioResponse {
  quickRatio: number;
  date: string;
}

@Injectable({ providedIn: 'root' })
export class DashboardApiService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/dashboard`;

  getQuickRatio(): Observable<QuickRatioResponse> {
    return this.http.get<QuickRatioResponse>(`${this.apiUrl}/kpi/quick-ratio`);
  }
}