import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { Ban, ExternalLink, LucideAngularModule, Pause, Play, RefreshCw, RotateCcw } from 'lucide-angular';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { AuthService } from '../../../core/services/auth';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { VX_UI } from '../../../shared/components';
import { eventFieldLabel, instanceStatusKey, instanceStatusTone, nodeTypeKey, outcomeLabel, taskStatusTone } from '../data/workflow-labels';
import {
  WorkflowGraphEdge,
  WorkflowInstanceDetail,
  WorkflowService,
  WorkflowTask,
  WorkflowTransition,
} from '../data/workflow.service';
import { CanvasEdge, CanvasNode, CanvasPrefs, WorkflowCanvasComponent } from '../designer/workflow-canvas.component';

const REFRESH_MS = 15000;
const REPLAY_STEP_MS = 650;
const RUNTIME_PREFS: CanvasPrefs = { snap: false, guides: false, minimap: true, background: 'dots', connectionsOnTop: false };

interface TimelineEntry {
  id: string;
  kind: string;
  text: string;
  comment?: string | null;
  at: string;
  actor: string | null;
  tone: 'ok' | 'info' | 'warning' | 'danger' | 'neutral';
  nodeId: string | null;
}

/**
 * One run of a process, as it happened.
 *
 * The process is drawn as its designer left it, with the path this run took coloured and animated,
 * the steps it finished marked done and the ones it is waiting on pulsing. Beside it: what the run
 * is about, its data, the open tasks and who holds them, and the full history in plain words — who
 * answered what, which branch a decision took, what an automatic step did. A running instance
 * refreshes itself; an operator can cancel it (with a reason, recorded) or retry a failed one.
 * «Replay» walks the path again step by step.
 */
@Component({
  selector: 'app-workflow-instance-page',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule, RouterLink, ...FORMAT_PIPES, ...VX_UI, WorkflowCanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workflow-instance.page.html',
  styleUrl: './workflow-instance.page.scss',
})
export class WorkflowInstancePage {
  private readonly service = inject(WorkflowService);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly translate = inject(TranslateService);
  private readonly auth = inject(AuthService);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  readonly id = input<string>('');

  private readonly canvas = viewChild(WorkflowCanvasComponent);

  readonly detail = signal<WorkflowInstanceDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly sideTab = signal<'summary' | 'data' | 'history'>('summary');
  /** Replay: how many transitions are shown; null shows them all. */
  readonly replayCursor = signal<number | null>(null);

  protected readonly prefs = RUNTIME_PREFS;
  protected readonly CancelIcon = Ban;
  protected readonly RetryIcon = RotateCcw;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly PlayIcon = Play;
  protected readonly PauseIcon = Pause;
  protected readonly OpenIcon = ExternalLink;

  readonly canRun = computed(() => this.auth.hasPermissions(['workflow_engine:run']));
  readonly instance = computed(() => this.detail()?.instance ?? null);
  readonly graph = computed(() => this.detail()?.definition?.graph ?? { nodes: [], edges: [] });
  readonly isRunning = computed(() => this.instance()?.status === 'RUNNING');
  readonly openTasks = computed(() => (this.detail()?.tasks ?? []).filter((t) => t.status === 'OPEN'));

  private readonly visibleTransitions = computed(() => {
    const all = this.detail()?.transitions ?? [];
    const cursor = this.replayCursor();
    return cursor === null ? all : all.slice(0, cursor);
  });

  /** Edges the run took: each transition from one node to the next, matched to the graph. */
  private readonly traversedEdges = computed(() => {
    const edges = this.graph().edges;
    const taken = new Set<string>();
    for (const t of this.visibleTransitions()) {
      const explicit = (t.detail as { edge?: string } | null)?.edge;
      if (explicit) {
        taken.add(explicit);
        continue;
      }
      if (!t.fromNodeId || !t.toNodeId) continue;
      const edge = matchEdge(edges, t);
      if (edge) taken.add(edge.id);
    }
    // The start node's single exit is taken as soon as the run exists.
    const start = this.graph().nodes.find((n) => n.type === 'start');
    const first = start && edges.find((e) => e.from === start.id);
    if (first && this.visibleTransitions().length) taken.add(first.id);
    return taken;
  });

  private readonly nodeStates = computed(() => {
    const states = new Map<string, CanvasNode['state']>();
    const replaying = this.replayCursor() !== null;
    for (const t of this.visibleTransitions()) {
      if (t.fromNodeId) states.set(t.fromNodeId, 'done');
      if (t.toNodeId) states.set(t.toNodeId, 'done');
    }
    const start = this.graph().nodes.find((n) => n.type === 'start');
    if (start && this.visibleTransitions().length) states.set(start.id, 'done');
    const instance = this.instance();
    if (!instance) return states;
    if (replaying) {
      const last = this.visibleTransitions().at(-1);
      if (last?.toNodeId) states.set(last.toNodeId, 'active');
      return states;
    }
    for (const token of instance.tokens ?? []) {
      if (token.state !== 'done') states.set(token.nodeId, token.state === 'waiting' ? 'waiting' : 'active');
    }
    if (instance.status === 'FAILED') {
      const last = (this.detail()?.transitions ?? []).filter((t) => t.toNodeId).at(-1);
      const failedAt = instance.tokens?.find((t) => t.state !== 'done')?.nodeId ?? last?.toNodeId;
      if (failedAt) states.set(failedAt, 'failed');
    }
    return states;
  });

  readonly canvasNodes = computed<CanvasNode[]>(() => {
    const states = this.nodeStates();
    return this.graph().nodes.map((node) => {
      const name = node.name?.trim() || this.translate.instant(nodeTypeKey(node.type));
      const state = states.get(node.id) ?? null;
      return {
        id: node.id,
        type: node.type,
        name,
        meta: state ? this.translate.instant(`workflow_engine.run_state.${state}`) : this.translate.instant('workflow_engine.run_state.pending'),
        position: node.position ?? { x: 0, y: 0 },
        parentId: node.parentId,
        state,
        dim: !state,
        ariaLabel: `${name}, ${state ? this.translate.instant(`workflow_engine.run_state.${state}`) : this.translate.instant('workflow_engine.run_state.pending')}`,
      };
    });
  });

  readonly canvasEdges = computed<CanvasEdge[]>(() => {
    const traversed = this.traversedEdges();
    const nodes = new Map(this.graph().nodes.map((n) => [n.id, n]));
    return this.graph().edges.map((edge) => {
      const source = nodes.get(edge.from);
      const label = edge.label || (edge.outcome ? outcomeLabel(this.translate, edge.outcome, source?.config?.outcomeLabels) : edge.default && source?.type === 'condition' ? this.translate.instant('workflow_engine.designer.otherwise') : '');
      return {
        id: edge.id,
        from: edge.from,
        to: edge.to,
        label,
        tone: edge.outcome ? 'outcome' : edge.default ? 'fallback' : edge.condition ? 'condition' : 'plain',
        waypoints: edge.waypoints,
        traversed: traversed.has(edge.id),
      };
    });
  });

  readonly canvasGroups = computed(() =>
    (this.graph().groups ?? []).map((group) => ({
      id: group.id,
      name: group.name ?? '',
      position: group.position ?? { x: 0, y: 0 },
      size: group.size ?? { width: 720, height: 220 },
      color: group.color ?? 'viz-1',
    })),
  );

  /** The run's data, labelled with the process's declared variables; internal keys hidden. */
  readonly facts = computed(() => {
    const instance = this.instance();
    if (!instance) return [];
    const declared = new Map((this.graph().variables ?? []).map((v) => [v.name, v.label || v.name]));
    return Object.entries(instance.context ?? {})
      .filter(([key]) => !key.startsWith('__'))
      .map(([key, value]) => ({
        key,
        label: declared.get(key) ?? eventFieldLabel(this.translate, key),
        value: formatValue(value),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  readonly timeline = computed<TimelineEntry[]>(() => {
    const detail = this.detail();
    if (!detail) return [];
    return [...detail.transitions].reverse().map((t) => this.describe(t, detail));
  });

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) untracked(() => this.load(id));
    });

    // A running instance moves on its own (timers, other people's answers): keep it current.
    const timer = setInterval(() => {
      if (this.isRunning() && document.visibilityState === 'visible' && this.replayCursor() === null && !this.busy()) this.load(this.id(), true);
    }, REFRESH_MS);
    let replay: ReturnType<typeof setInterval> | null = null;
    effect(() => {
      const cursor = this.replayCursor();
      untracked(() => {
        if (cursor === null && replay) {
          clearInterval(replay);
          replay = null;
        } else if (cursor !== null && !replay) {
          replay = setInterval(() => {
            const total = this.detail()?.transitions.length ?? 0;
            const next = (this.replayCursor() ?? 0) + 1;
            this.replayCursor.set(next > total ? null : next);
          }, REPLAY_STEP_MS);
        }
      });
    });
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      if (replay) clearInterval(replay);
    });
  }

  load(id: string, quiet = false): void {
    if (!id) return;
    if (!quiet) {
      this.loading.set(true);
      this.error.set(null);
    }
    this.service.getInstance(id).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.loading.set(false);
        this.tab?.setTitle(
          `${detail.definition?.name ?? this.translate.instant('workflow_engine.nav.instances')}${detail.instance.subject?.label ? ' · ' + detail.instance.subject.label : ''}`,
        );
      },
      error: (err: unknown) => {
        if (!quiet) this.error.set(this.notifications.httpErrorMessage(err, 'workflow_engine.load_failed'));
        this.loading.set(false);
      },
    });
  }

  link(path: string): string {
    return this.tenancy.urlFor(path);
  }

  toggleReplay(): void {
    this.replayCursor.set(this.replayCursor() === null ? 0 : null);
  }

  async cancel(): Promise<void> {
    const instance = this.instance();
    if (!instance || this.busy()) return;
    const reason = await this.dialog.prompt({
      title: 'workflow_engine.cancel_dialog.title',
      message: 'workflow_engine.cancel_dialog.message',
      placeholder: 'workflow_engine.cancel_dialog.placeholder',
      confirmText: 'workflow_engine.cancel_dialog.confirm',
      minLength: 3,
      tooShort: 'workflow_engine.cancel_dialog.too_short',
      variant: 'danger',
    });
    if (!reason?.trim()) return;
    this.busy.set(true);
    this.service.cancelInstance(instance.id, reason.trim()).subscribe({
      next: () => {
        this.busy.set(false);
        this.notifications.showSuccess('workflow_engine.cancelled');
        this.load(instance.id, true);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.notifications.showHttpError(err, 'workflow_engine.cancel_failed');
        this.load(instance.id, true);
      },
    });
  }

  retry(): void {
    const instance = this.instance();
    if (!instance || this.busy()) return;
    this.busy.set(true);
    this.service.retryInstance(instance.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.notifications.showSuccess('workflow_engine.retried');
        this.load(instance.id, true);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.notifications.showHttpError(err, 'workflow_engine.retry_failed');
      },
    });
  }

  statusKey = instanceStatusKey;
  statusTone = instanceStatusTone;
  taskTone(task: WorkflowTask) {
    return taskStatusTone(task.status);
  }

  taskOutcome(task: WorkflowTask): string {
    return task.outcome ? outcomeLabel(this.translate, task.outcome, task.outcomeLabels) : '—';
  }

  person(id: string | null | undefined): string {
    if (!id) return '';
    return this.detail()?.people[id] ?? '—';
  }

  taskAssignee(task: WorkflowTask): string {
    if (task.assigneeUserId) return this.person(task.assigneeUserId);
    if (task.assigneeRoleId) return this.translate.instant('workflow_engine.timeline.a_role');
    return '—';
  }

  focusNode(nodeId: string | null): void {
    if (nodeId) this.canvas()?.center(nodeId);
  }

  private describe(t: WorkflowTransition, detail: WorkflowInstanceDetail): TimelineEntry {
    const d = (t.detail ?? {}) as Record<string, unknown>;
    const actor = t.actorUserId ? this.person(t.actorUserId) : null;
    const node = (id: string | null | undefined) => {
      const found = detail.definition?.graph.nodes.find((n) => n.id === id);
      return found?.name?.trim() || (found ? this.translate.instant(nodeTypeKey(found.type)) : '—');
    };
    const name = (d['nodeName'] as string | null) || node(t.toNodeId ?? t.fromNodeId);
    const tr = (key: string, params: Record<string, unknown> = {}) => this.translate.instant(`workflow_engine.timeline.${key}`, params);
    let text: string;
    let tone: TimelineEntry['tone'] = 'neutral';
    let comment: string | null = null;
    switch (t.kind) {
      case 'started':
        text = actor ? tr('started_by', { actor }) : tr('started_auto');
        tone = 'info';
        break;
      case 'task_created':
        text = tr('task_created', { step: name });
        break;
      case 'task_completed': {
        const outcome = (d['outcome'] as string) ?? '';
        const label = (d['outcomeLabel'] as string | null) || outcomeLabel(this.translate, outcome);
        text = tr('task_completed', { actor: actor ?? '—', outcome: label, step: name });
        comment = (d['comment'] as string | null) ?? null;
        tone = /reject|deny|error|return/.test(outcome) ? 'warning' : 'ok';
        break;
      }
      case 'action':
        text = tr('action', { step: name, summary: (d['summary'] as string | null) ?? '' });
        if (d['outcome']) text += ` (${outcomeLabel(this.translate, String(d['outcome']))})`;
        break;
      case 'condition':
        text = tr('condition', {
          step: name,
          branch: (d['branch'] as string | null) || (d['isDefault'] ? this.translate.instant('workflow_engine.designer.otherwise') : '—'),
          next: (d['nextNodeName'] as string | null) || node(t.toNodeId),
        });
        break;
      case 'timer_set':
        text = tr('timer_set', { step: name, until: d['wakeAt'] ? new Date(String(d['wakeAt'])).toLocaleString(this.translate.currentLang) : '—' });
        break;
      case 'timer_fired':
        text = tr('timer_fired', { step: name });
        break;
      case 'escalated':
        text = tr('escalated', { step: name });
        tone = 'warning';
        break;
      case 'completed':
        text = tr('completed', { result: (d['result'] as string | null) || '—' });
        tone = 'ok';
        break;
      case 'cancelled':
        text = tr('cancelled', { actor: actor ?? '—' });
        comment = (d['reason'] as string | null) ?? null;
        tone = 'danger';
        break;
      case 'retried':
        text = tr('retried', { actor: actor ?? '—' });
        tone = 'info';
        break;
      case 'error':
        text = tr('error', { message: (d['message'] as string | null) ?? '—' });
        tone = 'danger';
        break;
      default:
        text = tr('entered', { step: name });
    }
    return { id: t.id, kind: t.kind, text, comment, at: t.createdAt, actor, tone, nodeId: t.toNodeId ?? t.fromNodeId };
  }
}

function matchEdge(edges: WorkflowGraphEdge[], t: WorkflowTransition): WorkflowGraphEdge | undefined {
  const outcome = (t.detail as { outcome?: string } | null)?.outcome;
  const candidates = edges.filter((e) => e.from === t.fromNodeId && e.to === t.toNodeId);
  return candidates.find((e) => outcome && e.outcome === outcome) ?? candidates[0];
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
