import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AiReport } from '../cashflow/cashflow.service';

export interface CloseStep {
  id: string;
  description: string;
  note: string | null;
  done: boolean;
  pending: number | null;
  link: string | null;
  priority: number;
}

export interface CloseAssistantView {
  period: { id: string; name: string; startDate: string; endDate: string; status: string };
  progress: number;
  steps: CloseStep[];
  openAnomalies: { critical: number; high: number; medium: number; low: number };
  mailedBillsToReview: number;
  ready: boolean;
}

@Injectable({ providedIn: 'root' })
export class CloseAssistantService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/ai/close-assistant`;

  view(periodId: string): Observable<CloseAssistantView> {
    return this.http.get<CloseAssistantView>(`${this.url}/${periodId}`);
  }

  /** The latest plan written for the period (or the one being written), or null. */
  plan(periodId: string): Observable<AiReport | null> {
    return this.http.get<AiReport | null>(`${this.url}/${periodId}/plan`);
  }

  requestPlan(periodId: string): Observable<AiReport> {
    return this.http.post<AiReport>(`${this.url}/${periodId}/plan`, {});
  }
}
