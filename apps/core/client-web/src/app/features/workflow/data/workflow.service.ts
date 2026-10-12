import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

// ── Graph model (mirrors the backend `workflow-graph` contracts) ───────────────

export type WorkflowNodeType = 'start' | 'end' | 'task' | 'approval' | 'condition' | 'action' | 'timer';

export type WorkflowPredicate =
  | { all: WorkflowPredicate[] }
  | { any: WorkflowPredicate[] }
  | { not: WorkflowPredicate }
  | {
      var: string;
      op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'contains' | 'exists' | 'truthy';
      value?: unknown;
    };

export interface WorkflowNodeConfig {
  assigneeRoleId?: string;
  assigneeUserId?: string;
  outcomes?: string[];
  dueInHours?: number;
  action?: string;
  actionParams?: Record<string, unknown>;
  timerMinutes?: number;
  timerUntilVar?: string;
}

export interface WorkflowGraphNode {
  id: string;
  type: WorkflowNodeType;
  name?: string;
  position?: { x: number; y: number };
  config?: WorkflowNodeConfig;
}

export interface WorkflowGraphEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  outcome?: string;
  condition?: WorkflowPredicate;
  default?: boolean;
}

export interface WorkflowGraph {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

export interface WorkflowTrigger {
  mode: 'manual' | 'event';
  event?: string;
}

// ── Entities ───────────────────────────────────────────────────────────────────

export type WorkflowDefinitionStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type WorkflowInstanceStatus = 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
export type WorkflowTaskStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED';

export interface WorkflowDefinition {
  id: string;
  key: string;
  name: string;
  description: string | null;
  version: number;
  status: WorkflowDefinitionStatus;
  graph: WorkflowGraph;
  trigger: WorkflowTrigger;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowToken {
  id: string;
  nodeId: string;
  state: 'active' | 'waiting' | 'done';
  waitKind?: 'task' | 'timer';
  wakeAt?: string;
}

export interface WorkflowInstance {
  id: string;
  definitionId: string;
  definitionVersion: number;
  status: WorkflowInstanceStatus;
  context: Record<string, unknown>;
  tokens: WorkflowToken[];
  subject: { type?: string; id?: string; label?: string } | null;
  startedByUserId: string | null;
  nextWakeAt: string | null;
  error: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface WorkflowTask {
  id: string;
  instanceId: string;
  nodeId: string;
  tokenId: string;
  name: string;
  assigneeRoleId: string | null;
  assigneeUserId: string | null;
  outcomes: string[];
  status: WorkflowTaskStatus;
  outcome: string | null;
  dueAt: string | null;
  completedByUserId: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface WorkflowTransition {
  id: string;
  instanceId: string;
  fromNodeId: string | null;
  toNodeId: string | null;
  kind: string;
  detail: Record<string, unknown> | null;
  actorUserId: string | null;
  createdAt: string;
}

export interface WorkflowInstanceDetail {
  instance: WorkflowInstance;
  tasks: WorkflowTask[];
  transitions: WorkflowTransition[];
  definition: WorkflowDefinition | null;
}

export interface WorkflowActionCatalogueItem {
  key: string;
  labelKey: string;
}

/** The Business Workflow engine API, against `/workflow-engine`. */
@Injectable({ providedIn: 'root' })
export class WorkflowService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/workflow-engine`;
  private readonly options = { withCredentials: true as const };

  // Definitions
  listDefinitions(): Observable<WorkflowDefinition[]> {
    return this.http.get<WorkflowDefinition[]>(`${this.apiUrl}/definitions`, this.options);
  }

  getDefinition(id: string): Observable<WorkflowDefinition> {
    return this.http.get<WorkflowDefinition>(`${this.apiUrl}/definitions/${id}`, this.options);
  }

  createDefinition(body: {
    name: string;
    description?: string | null;
    graph?: WorkflowGraph;
    trigger?: WorkflowTrigger;
  }): Observable<WorkflowDefinition> {
    return this.http.post<WorkflowDefinition>(`${this.apiUrl}/definitions`, body, this.options);
  }

  updateDefinition(
    id: string,
    body: {
      name?: string;
      description?: string | null;
      graph?: WorkflowGraph;
      trigger?: WorkflowTrigger;
    },
  ): Observable<WorkflowDefinition> {
    return this.http.patch<WorkflowDefinition>(`${this.apiUrl}/definitions/${id}`, body, this.options);
  }

  publish(id: string): Observable<WorkflowDefinition> {
    return this.http.post<WorkflowDefinition>(`${this.apiUrl}/definitions/${id}/publish`, {}, this.options);
  }

  newVersion(id: string): Observable<WorkflowDefinition> {
    return this.http.post<WorkflowDefinition>(`${this.apiUrl}/definitions/${id}/versions`, {}, this.options);
  }

  deleteDefinition(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/definitions/${id}`, this.options);
  }

  actions(): Observable<WorkflowActionCatalogueItem[]> {
    return this.http.get<WorkflowActionCatalogueItem[]>(`${this.apiUrl}/actions`, this.options);
  }

  // Instances
  listInstances(params: { status?: WorkflowInstanceStatus; definitionId?: string } = {}): Observable<WorkflowInstance[]> {
    return this.http.get<WorkflowInstance[]>(`${this.apiUrl}/instances`, { ...this.options, params });
  }

  getInstance(id: string): Observable<WorkflowInstanceDetail> {
    return this.http.get<WorkflowInstanceDetail>(`${this.apiUrl}/instances/${id}`, this.options);
  }

  startInstance(
    definitionId: string,
    body: { context?: Record<string, unknown>; subject?: { type?: string; id?: string; label?: string } } = {},
  ): Observable<WorkflowInstance> {
    return this.http.post<WorkflowInstance>(`${this.apiUrl}/definitions/${definitionId}/start`, body, this.options);
  }

  cancelInstance(id: string): Observable<WorkflowInstance> {
    return this.http.post<WorkflowInstance>(`${this.apiUrl}/instances/${id}/cancel`, {}, this.options);
  }

  // Tasks
  myTasks(): Observable<WorkflowTask[]> {
    return this.http.get<WorkflowTask[]>(`${this.apiUrl}/tasks`, this.options);
  }

  completeTask(id: string, body: { outcome: string; formData?: Record<string, unknown> }): Observable<WorkflowInstance> {
    return this.http.post<WorkflowInstance>(`${this.apiUrl}/tasks/${id}/complete`, body, this.options);
  }
}
