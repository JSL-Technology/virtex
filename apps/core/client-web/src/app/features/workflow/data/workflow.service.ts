import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

// ── Graph model (mirrors the backend `workflow-graph` contracts) ───────────────

export type WorkflowNodeType = 'start' | 'end' | 'task' | 'approval' | 'condition' | 'action' | 'timer';

export const PREDICATE_OPS = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'nin',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'exists',
  'not_exists',
  'truthy',
  'falsy',
] as const;
export type PredicateOp = (typeof PREDICATE_OPS)[number];
export const UNARY_OPS: ReadonlySet<PredicateOp> = new Set(['exists', 'not_exists', 'truthy', 'falsy']);

export interface PredicateLeaf {
  var: string;
  op: PredicateOp;
  value?: unknown;
}
export type WorkflowPredicate = { all: WorkflowPredicate[] } | { any: WorkflowPredicate[] } | { not: WorkflowPredicate } | PredicateLeaf;

export const VARIABLE_TYPES = ['string', 'text', 'number', 'boolean', 'date', 'select', 'user'] as const;
export type WorkflowVariableType = (typeof VARIABLE_TYPES)[number];

export interface WorkflowVariable {
  name: string;
  label?: string;
  type: WorkflowVariableType;
  required?: boolean;
  options?: string[];
  description?: string;
}

export interface WorkflowNodeConfig {
  assigneeRoleId?: string;
  assigneeUserId?: string;
  outcomes?: string[];
  outcomeLabels?: Record<string, string>;
  commentRequiredFor?: string[];
  form?: WorkflowVariable[];
  instructions?: string;
  dueInHours?: number;
  escalateToUserId?: string;
  action?: string;
  actionParams?: Record<string, unknown>;
  timerMinutes?: number;
  timerUntilVar?: string;
}

export interface WorkflowPoint {
  x: number;
  y: number;
}

export interface WorkflowGraphNode {
  id: string;
  type: WorkflowNodeType;
  name?: string;
  description?: string;
  position?: WorkflowPoint;
  parentId?: string;
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
  waypoints?: WorkflowPoint[];
}

export interface WorkflowGraphGroup {
  id: string;
  name?: string;
  position?: WorkflowPoint;
  size?: { width: number; height: number };
  color?: string;
}

export type ConnectionStyle = 'segment' | 'straight' | 'bezier' | 'adaptive-curve';

export interface WorkflowGraphSettings {
  connectionType?: ConnectionStyle;
  layoutDirection?: 'LR' | 'TB';
}

export interface WorkflowGraph {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  groups?: WorkflowGraphGroup[];
  variables?: WorkflowVariable[];
  settings?: WorkflowGraphSettings;
}

export interface WorkflowTrigger {
  mode: 'manual' | 'event';
  event?: string;
  filter?: WorkflowPredicate;
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
  publishedAt: string | null;
  publishedByUserId: string | null;
}

export interface WorkflowVersionSummary {
  id: string;
  version: number;
  status: WorkflowDefinitionStatus;
  updatedAt: string;
  publishedAt: string | null;
  publishedByUserId: string | null;
}

export interface WorkflowDefinitionSummary {
  key: string;
  name: string;
  description: string | null;
  trigger: WorkflowTrigger;
  published: WorkflowDefinition | null;
  draft: WorkflowDefinition | null;
  versions: WorkflowVersionSummary[];
  updatedAt: string;
  runningCount: number;
}

export interface WorkflowToken {
  id: string;
  nodeId: string;
  state: 'active' | 'waiting' | 'done';
  waitKind?: 'task' | 'timer';
  wakeAt?: string;
}

export interface WorkflowSubject {
  type?: string;
  id?: string;
  label?: string;
  route?: string;
}

export interface WorkflowInstance {
  id: string;
  definitionId: string;
  definitionVersion: number;
  status: WorkflowInstanceStatus;
  context: Record<string, unknown>;
  tokens: WorkflowToken[];
  subject: WorkflowSubject | null;
  startedByUserId: string | null;
  parentInstanceId: string | null;
  nextWakeAt: string | null;
  error: string | null;
  result: string | null;
  cancelReason: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Decorations from the list/detail endpoints.
  definitionName?: string | null;
  definitionKey?: string | null;
  currentSteps?: string[];
  startedByName?: string | null;
  openTaskCount?: number;
}

export interface WorkflowInstancePage {
  items: WorkflowInstance[];
  total: number;
  page: number;
  pageSize: number;
}

export interface WorkflowTask {
  id: string;
  instanceId: string;
  nodeId: string;
  nodeType: 'task' | 'approval';
  tokenId: string;
  name: string;
  assigneeRoleId: string | null;
  assigneeUserId: string | null;
  outcomes: string[];
  outcomeLabels: Record<string, string> | null;
  commentRequiredFor: string[] | null;
  form: WorkflowVariable[] | null;
  instructions: string | null;
  status: WorkflowTaskStatus;
  outcome: string | null;
  comment: string | null;
  formData: Record<string, unknown> | null;
  dueAt: string | null;
  completedByUserId: string | null;
  completedAt: string | null;
  createdAt: string;
  // Inbox decorations.
  subject?: WorkflowSubject | null;
  definitionName?: string | null;
  definitionVersion?: number | null;
  instanceStatus?: WorkflowInstanceStatus | null;
  startedByName?: string | null;
  assigneeName?: string | null;
  completedByName?: string | null;
  facts?: Array<{ name: string; label: string | null; type: string; value: unknown }>;
  overdue?: boolean;
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
  people: Record<string, string>;
  children: Array<{ id: string; status: WorkflowInstanceStatus; createdAt: string; definitionName: string | null }>;
}

export interface WorkflowActionParam {
  name: string;
  labelKey: string;
  type: 'string' | 'text' | 'number' | 'boolean' | 'url' | 'user' | 'select' | 'json';
  required?: boolean;
  options?: string[];
  templated?: boolean;
  maxLength?: number;
  hintKey?: string;
}

export interface WorkflowActionCatalogueItem {
  key: string;
  labelKey: string;
  descriptionKey: string | null;
  outcomes: string[];
  params: WorkflowActionParam[];
}

export interface WorkflowEventCatalogueItem {
  key: string;
  group: string;
  fields: WorkflowVariable[];
}

export interface WorkflowEventCatalogue {
  customPrefix: string;
  events: WorkflowEventCatalogueItem[];
}

export interface WorkflowAssignees {
  users: Array<{ id: string; name: string; email: string }>;
  roles: Array<{ id: string; name: string; isSystem: boolean }>;
}

export interface WorkflowIssue {
  code: string;
  severity: 'error' | 'warning';
  nodeId?: string;
  edgeId?: string;
  params?: Record<string, string | number>;
}

export interface ListInstancesFilter {
  status?: WorkflowInstanceStatus | '';
  definitionId?: string;
  key?: string;
  search?: string;
  from?: string;
  to?: string;
  scope?: 'all' | 'mine';
  page?: number;
  pageSize?: number;
}

/** The Business Workflow engine API, against `/workflow-engine`. */
@Injectable({ providedIn: 'root' })
export class WorkflowService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/workflow-engine`;
  private readonly options = { withCredentials: true as const };

  // Definitions
  catalogue(search?: string): Observable<WorkflowDefinitionSummary[]> {
    const params = search?.trim() ? new HttpParams().set('search', search.trim()) : undefined;
    return this.http.get<WorkflowDefinitionSummary[]>(`${this.apiUrl}/definitions/catalogue`, { ...this.options, params });
  }

  getDefinition(id: string): Observable<WorkflowDefinition> {
    return this.http.get<WorkflowDefinition>(`${this.apiUrl}/definitions/${id}`, this.options);
  }

  createDefinition(body: { name: string; description?: string | null; graph?: WorkflowGraph; trigger?: WorkflowTrigger }): Observable<WorkflowDefinition> {
    return this.http.post<WorkflowDefinition>(`${this.apiUrl}/definitions`, body, this.options);
  }

  updateDefinition(
    id: string,
    body: { name?: string; description?: string | null; graph?: WorkflowGraph; trigger?: WorkflowTrigger; expectedUpdatedAt?: string },
  ): Observable<WorkflowDefinition> {
    return this.http.patch<WorkflowDefinition>(`${this.apiUrl}/definitions/${id}`, body, this.options);
  }

  validate(graph: WorkflowGraph, trigger: WorkflowTrigger): Observable<{ issues: WorkflowIssue[] }> {
    return this.http.post<{ issues: WorkflowIssue[] }>(`${this.apiUrl}/definitions/validate`, { graph, trigger }, this.options);
  }

  publish(id: string, rollback = false): Observable<WorkflowDefinition> {
    return this.http.post<WorkflowDefinition>(`${this.apiUrl}/definitions/${id}/publish`, { rollback }, this.options);
  }

  unpublish(id: string): Observable<WorkflowDefinition> {
    return this.http.post<WorkflowDefinition>(`${this.apiUrl}/definitions/${id}/unpublish`, {}, this.options);
  }

  newVersion(id: string): Observable<WorkflowDefinition> {
    return this.http.post<WorkflowDefinition>(`${this.apiUrl}/definitions/${id}/versions`, {}, this.options);
  }

  duplicate(id: string, name?: string): Observable<WorkflowDefinition> {
    return this.http.post<WorkflowDefinition>(`${this.apiUrl}/definitions/${id}/duplicate`, { name }, this.options);
  }

  deleteDefinition(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/definitions/${id}`, this.options);
  }

  actions(): Observable<WorkflowActionCatalogueItem[]> {
    return this.http.get<WorkflowActionCatalogueItem[]>(`${this.apiUrl}/actions`, this.options);
  }

  events(): Observable<WorkflowEventCatalogue> {
    return this.http.get<WorkflowEventCatalogue>(`${this.apiUrl}/events`, this.options);
  }

  assignees(search?: string): Observable<WorkflowAssignees> {
    const params = search?.trim() ? new HttpParams().set('search', search.trim()) : undefined;
    return this.http.get<WorkflowAssignees>(`${this.apiUrl}/assignees`, { ...this.options, params });
  }

  // Instances
  listInstances(filter: ListInstancesFilter = {}): Observable<WorkflowInstancePage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filter)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<WorkflowInstancePage>(`${this.apiUrl}/instances`, { ...this.options, params });
  }

  getInstance(id: string): Observable<WorkflowInstanceDetail> {
    return this.http.get<WorkflowInstanceDetail>(`${this.apiUrl}/instances/${id}`, this.options);
  }

  startInstance(definitionId: string, body: { context?: Record<string, unknown>; subject?: WorkflowSubject }): Observable<WorkflowInstance> {
    return this.http.post<WorkflowInstance>(`${this.apiUrl}/definitions/${definitionId}/start`, body, this.options);
  }

  cancelInstance(id: string, reason: string): Observable<WorkflowInstance> {
    return this.http.post<WorkflowInstance>(`${this.apiUrl}/instances/${id}/cancel`, { reason }, this.options);
  }

  retryInstance(id: string): Observable<WorkflowInstance> {
    return this.http.post<WorkflowInstance>(`${this.apiUrl}/instances/${id}/retry`, {}, this.options);
  }

  // Tasks
  myTasks(view: 'open' | 'done' = 'open'): Observable<WorkflowTask[]> {
    return this.http.get<WorkflowTask[]>(`${this.apiUrl}/tasks`, { ...this.options, params: new HttpParams().set('view', view) });
  }

  getTask(id: string): Observable<WorkflowTask> {
    return this.http.get<WorkflowTask>(`${this.apiUrl}/tasks/${id}`, this.options);
  }

  completeTask(id: string, body: { outcome: string; formData?: Record<string, unknown>; comment?: string }): Observable<WorkflowInstance> {
    return this.http.post<WorkflowInstance>(`${this.apiUrl}/tasks/${id}/complete`, body, this.options);
  }
}
