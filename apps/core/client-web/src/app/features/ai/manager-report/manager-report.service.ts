import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AiReport } from '../cashflow/cashflow.service';

export interface ManagerReportSummary {
  id: string;
  period: string | null;
  status: AiReport['status'];
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  language: string;
}

export interface ManagerReport extends AiReport {
  period: string | null;
  facts: Record<string, unknown> | null;
}

@Injectable({ providedIn: 'root' })
export class ManagerReportService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/ai/reports/manager`;

  list(): Observable<ManagerReportSummary[]> {
    return this.http.get<ManagerReportSummary[]>(this.url);
  }

  get(id: string): Observable<ManagerReport> {
    return this.http.get<ManagerReport>(`${this.url}/${id}`);
  }

  /** Write (or return the one being written for) a closed month, `YYYY-MM`. */
  request(period?: string): Observable<ManagerReport> {
    return this.http.post<ManagerReport>(this.url, period ? { period } : {});
  }
}
