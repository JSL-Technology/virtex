import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

/** What the company decided about its AI, as in effect (its own values over the platform defaults). */
export interface AiPolicySettings {
  languageModels: boolean;
  disabledFeatures: string[];
  scheduledReports: boolean;
  imageEmbeddings: boolean;
  monthlyBudgetUsd: number;
  dailyBudgetUsd: number | null;
  conversationRetentionDays: number;
  maskIdentifiers: boolean;
  maxMonthlyBudgetUsd: number;
}

export interface AiPolicy {
  settings: AiPolicySettings;
  spend: { monthUsd: number; dayUsd: number };
  /** Every AI feature that calls a language model, by its stable name. */
  features: string[];
}

export type AiPolicyChange = Partial<Omit<AiPolicySettings, 'maxMonthlyBudgetUsd' | 'monthlyBudgetUsd'>> & {
  monthlyBudgetUsd?: number | null;
};

@Injectable({ providedIn: 'root' })
export class AiPolicyService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/ai/settings`;

  get(): Observable<AiPolicy> {
    return this.http.get<AiPolicy>(this.url);
  }

  update(change: AiPolicyChange): Observable<AiPolicy> {
    return this.http.put<AiPolicy>(this.url, change);
  }
}
