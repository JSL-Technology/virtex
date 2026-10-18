import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface AgentProposal {
  kind: string;
  id: string;
  label: string;
  link: string | null;
  state: string;
}

export interface AgentRun {
  id: string;
  agent: string;
  trigger: 'SCHEDULED' | 'MANUAL' | 'WORKFLOW';
  status: 'SUCCEEDED' | 'FAILED' | 'NOTHING_TO_DO';
  summary: Record<string, number | string | null>;
  proposals: AgentProposal[];
  notes: Array<{ key: string; params?: Record<string, unknown> }>;
  startedAt: string;
  finishedAt: string;
}

export interface CopilotProposalEntry {
  id: string;
  tool: string;
  summary: string;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  link: string | null;
}

export interface ReplenishmentSettings {
  enabled: boolean;
  warehouseIds: string[];
  submitForApproval: boolean;
  maxOrderAmount: number | null;
}

@Injectable({ providedIn: 'root' })
export class AgentsApiService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  runs(): Observable<AgentRun[]> {
    return this.http.get<AgentRun[]>(`${this.api}/ai/agents/runs`);
  }

  copilotProposals(): Observable<CopilotProposalEntry[]> {
    return this.http.get<CopilotProposalEntry[]>(`${this.api}/ai/agents/copilot-proposals`);
  }

  replenishmentSettings(): Observable<ReplenishmentSettings> {
    return this.http.get<ReplenishmentSettings>(`${this.api}/procurement/replenishment-agent/settings`);
  }

  updateReplenishment(changes: Partial<ReplenishmentSettings>): Observable<ReplenishmentSettings> {
    return this.http.patch<ReplenishmentSettings>(`${this.api}/procurement/replenishment-agent/settings`, changes);
  }

  runReplenishment(): Observable<{ runId: string | null; orders: AgentProposal[] }> {
    return this.http.post<{ runId: string | null; orders: AgentProposal[] }>(`${this.api}/procurement/replenishment-agent/run`, {});
  }
}
