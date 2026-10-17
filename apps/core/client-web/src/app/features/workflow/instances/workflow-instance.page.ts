import { composeKey } from '@virteex/shared/types';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FORMAT_PIPES, FormatService, LocaleStore, translateOrLiteral } from '@virteex/shared/ui-i18n';
import { Ban, ExternalLink, LucideAngularModule, Pause, Play, RefreshCw, RotateCcw } from 'lucide-angular';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { AuthService } from '../../../core/services/auth';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { roleLabel } from '../../../shared/pipes/role-name.pipe';
import { VX_UI } from '../../../shared/components';
import { currentStepsText, eventFieldLabel, eventLabel, instanceStatusKey, instanceStatusTone, nodeTypeKey, outcomeLabel, runFailureText, taskStatusTone } from '../data/workflow-labels';
import {
  WorkflowGraphEdge,
  WorkflowInstance,
  WorkflowInstanceDetail,
  WorkflowService,
  WorkflowTask,
  WorkflowTransition,
} from '../data/workflow.service';
import { CanvasEdge, CanvasNode, CanvasPrefs, WorkflowCanvasComponent } from '../designer/workflow-canvas.component';
import { setSummaryLocale, summarizePredicate } from '../designer/predicate-summary';

const REFRESH_MS = 15000;
const REPLAY_STEP_MS = 650;
const RUNTIME_PREFS: CanvasPrefs = { snap: false, guides: false, minimap: true, background: 'dots', connectionsOnTop: false };

/** Context keys the engine writes itself; each has its own words in the catalogue. */
const ENGINE_FACTS = new Set(['lastOutcome', 'lastComment', 'lastActorUserId', 'event', 'webhook', 'subprocess', 'document', 'parentInstanceId']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export interface RunFact {
  key: string;
  label: string;
  value: string;
  /** A comment or a reason that belongs to the value, shown as a quote under it. */
  note?: string | null;
  group: 'data' | 'steps' | 'system';
}

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
  private readonly format = inject(FormatService);
  private readonly localeStore = inject(LocaleStore);
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
    // An automatic step that answered «error» failed even when the run went on along its error path.
    for (const t of this.visibleTransitions()) {
      if (t.kind === 'action' && t.fromNodeId && (t.detail as { failed?: boolean } | null)?.failed) states.set(t.fromNodeId, 'failed');
    }
    if (instance.status === 'FAILED') {
      const last = (this.detail()?.transitions ?? []).filter((t) => t.toNodeId).at(-1);
      const failedAt = instance.tokens?.find((t) => t.state !== 'done')?.nodeId ?? last?.toNodeId;
      if (failedAt) states.set(failedAt, 'failed');
    }
    if (instance.status === 'CANCELLED') {
      // The steps the run was waiting on when it was cancelled: they never finished, and they say so.
      const cancelled = (this.detail()?.transitions ?? []).find((t) => t.kind === 'cancelled');
      const interrupted = ((cancelled?.detail as { interruptedNodes?: string[] } | null)?.interruptedNodes ?? []) as string[];
      for (const nodeId of interrupted) states.set(nodeId, 'cancelled');
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
        meta: state ? this.translate.instant(composeKey('workflow_engine.run_state', state)) : this.translate.instant('workflow_engine.run_state.pending'),
        position: node.position ?? { x: 0, y: 0 },
        parentId: node.parentId,
        state,
        dim: !state,
        ariaLabel: `${name}, ${state ? this.translate.instant(composeKey('workflow_engine.run_state', state)) : this.translate.instant('workflow_engine.run_state.pending')}`,
      };
    });
  });

  readonly canvasEdges = computed<CanvasEdge[]>(() => {
    const traversed = this.traversedEdges();
    const nodes = new Map(this.graph().nodes.map((n) => [n.id, n]));
    return this.graph().edges.map((edge) => {
      const source = nodes.get(edge.from);
      const label = this.edgeCaption(edge, source?.type, source?.config?.outcomeLabels);
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

  /**
   * The run's data in the reader's words: the process's variables by their labels, the answers its
   * steps collected by the step's name, and what the engine itself recorded (the last decision, a
   * webhook's reply) by catalogue labels. Never a raw key, a UUID or a JSON dump; internal keys hidden.
   */
  readonly facts = computed<RunFact[]>(() => {
    const instance = this.instance();
    if (!instance) return [];
    const graph = this.graph();
    const labels = new Map<string, string>();
    for (const variable of graph.variables ?? []) labels.set(variable.name, variable.label || variable.name);
    for (const node of graph.nodes) {
      for (const field of node.config?.form ?? []) if (!labels.has(field.name)) labels.set(field.name, field.label || field.name);
    }
    const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    const order = { data: 0, steps: 1, system: 2 } as const;
    const facts: RunFact[] = [];
    for (const [key, value] of Object.entries(instance.context ?? {})) {
      if (key.startsWith('__')) continue;
      const node = nodes.get(key);
      if (node && value && typeof value === 'object') {
        const answer = value as { outcome?: string; comment?: string | null; by?: string; at?: string };
        const step = node.name?.trim() || this.translate.instant(nodeTypeKey(node.type));
        const parts = [answer.outcome ? outcomeLabel(this.translate, answer.outcome, node.config?.outcomeLabels) : null, answer.by ? this.person(answer.by) : null, answer.at ? this.format.date(answer.at, 'dateTime') : null];
        facts.push({
          key,
          label: this.translate.instant('workflow_engine.fact.step_result', { step }),
          value: parts.filter(Boolean).join(' · ') || '—',
          note: answer.comment || null,
          group: 'steps',
        });
        continue;
      }
      if (ENGINE_FACTS.has(key)) {
        facts.push({ key, label: this.translate.instant(composeKey('workflow_engine.fact', key)), value: this.engineValue(key, value), group: 'system' });
        continue;
      }
      facts.push({ key, label: labels.get(key) ?? eventFieldLabel(this.translate, key), value: this.formatValue(value), group: 'data' });
    }
    const compare = this.format.comparator();
    return facts.sort((a, b) => order[a.group] - order[b.group] || compare(a.label, b.label));
  });

  factsIn(group: string): RunFact[] {
    return this.facts().filter((fact) => fact.group === group);
  }

  readonly timeline = computed<TimelineEntry[]>(() => {
    const detail = this.detail();
    if (!detail) return [];
    return [...detail.transitions].reverse().map((t) => this.describe(t, detail));
  });

  constructor() {
    effect(() => setSummaryLocale(this.localeStore.locale()));
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
        // Two runs of the same process open side by side must not read the same: the subject, else when it started.
        const what = detail.instance.subject?.label || this.format.date(detail.instance.createdAt, 'dateTime');
        this.tab?.setTitle(`${detail.definition?.name ?? this.translate.instant('workflow_engine.nav.instances')} · ${what}`);
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
      // «Cancelar» next to «Cancelar ejecución» asked the reader to guess which one stops the run.
      cancelText: 'workflow_engine.cancel_dialog.keep',
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

  taskStatusKey(task: WorkflowTask): string {
    return composeKey('workflow_engine.task_status', task.status);
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
    if (task.assigneeRoleId) {
      const name = this.detail()?.roles?.[task.assigneeRoleId];
      return name ? roleLabel(this.translate, name) : this.translate.instant('workflow_engine.timeline.a_role');
    }
    return '—';
  }

  /**
   * Why the run failed, worded from the last error the engine recorded (it carries the catalogue key
   * and its parameters); the instance's own `error` is the fallback for runs recorded before that.
   */
  readonly failure = computed(() => {
    const instance = this.instance();
    if (!instance || instance.status !== 'FAILED') return null;
    const last = [...(this.detail()?.transitions ?? [])].reverse().find((t) => t.kind === 'error');
    return last ? this.failureOf((last.detail ?? {}) as Record<string, unknown>) : runFailureText(this.translate, instance.error);
  });

  currentSteps(run: WorkflowInstance): string {
    return currentStepsText(this.translate, run);
  }

  /**
   * What a connection says: the author's caption, the outcome it follows, «Otherwise», or — for a
   * condition branch — the rule itself, worded with the process's variable labels («Importe
   * solicitado > 1.000»), exactly as the designer draws it.
   */
  private edgeCaption(edge: WorkflowGraphEdge, sourceType?: string, outcomeLabels?: Record<string, string>): string {
    if (edge.label) return edge.label;
    if (edge.outcome) return outcomeLabel(this.translate, edge.outcome, outcomeLabels);
    if (edge.default) return sourceType === 'condition' ? this.translate.instant('workflow_engine.designer.otherwise') : '';
    if (edge.condition) {
      this.localeStore.locale();
      const labels = new Map((this.graph().variables ?? []).map((v) => [v.name, v.label || v.name]));
      return summarizePredicate(this.translate, edge.condition, (v) => labels.get(v) ?? eventFieldLabel(this.translate, v), 40);
    }
    return '';
  }

  private failureOf(d: Record<string, unknown>): string {
    const key = d['messageKey'] as string | undefined;
    const params = { ...((d['params'] as Record<string, unknown> | null) ?? {}) };
    if (key && key !== 'workflow_engine.runtime.unexpected') return runFailureText(this.translate, key, params);
    return runFailureText(this.translate, (d['message'] as string | null) ?? (params['detail'] as string | null) ?? null);
  }

  private engineValue(key: string, value: unknown): string {
    switch (key) {
      case 'lastOutcome':
        return typeof value === 'string' ? outcomeLabel(this.translate, value) : this.formatValue(value);
      case 'lastActorUserId':
        return typeof value === 'string' ? this.person(value) || '—' : '—';
      case 'event':
        return typeof value === 'string' ? eventLabel(this.translate, value) : this.formatValue(value);
      case 'webhook': {
        // The rejection reason is a code (`host_unresolvable`): word it as the timeline does.
        const reply = (value ?? {}) as Record<string, unknown>;
        const reason = typeof reply['reason'] === 'string' ? reply['reason'] : null;
        return this.formatValue(
          reason ? { ...reply, reason: translateOrLiteral(this.translate, composeKey('workflow_engine.webhook_result', reason), { status: reply['status'] ?? '' }, reason) } : reply,
        );
      }
      default:
        return this.formatValue(value);
    }
  }

  /** A value as the reader writes it: numbers and instants in their locale, people by name, objects as «label: value». */
  private formatValue(value: unknown, depth = 0): string {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return this.translate.instant(value ? 'workflow_engine.yes' : 'workflow_engine.no');
    if (typeof value === 'number') return this.format.number(value);
    if (typeof value === 'string') {
      // A catalogue key the engine stored as a reason (`workflow_engine.document_result.no_document`).
      if (/^workflow_engine\.[a-z0-9_.]+$/.test(value)) return translateOrLiteral(this.translate, value, undefined, value);
      if (UUID.test(value)) return this.detail()?.people[value] ?? this.translate.instant('workflow_engine.fact.reference');
      if (ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value))) return this.format.date(value, 'dateTime');
      return value;
    }
    if (Array.isArray(value)) return value.length ? this.format.list(value.map((item) => this.formatValue(item, depth + 1))) : '—';
    if (typeof value === 'object') {
      if (depth > 1) return '…';
      const entries = Object.entries(value as Record<string, unknown>).filter(([k, v]) => v !== null && v !== undefined && v !== '' && !UUID.test(String(k)));
      if (!entries.length) return '—';
      return entries
        .map(([k, v]) => `${translateOrLiteral(this.translate, composeKey('workflow_engine.fact_field', k), undefined, eventFieldLabel(this.translate, k))}: ${this.formatValue(v, depth + 1)}`)
        .join(' · ');
    }
    return String(value);
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
    const tr = (key: string, params: Record<string, unknown> = {}) => this.translate.instant(composeKey('workflow_engine.timeline', key), params);
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
      case 'action': {
        const summaryKey = d['summaryKey'] as string | null;
        const summary = summaryKey
          ? translateOrLiteral(this.translate, summaryKey, (d['summaryParams'] as Record<string, unknown> | null) ?? undefined, (d['summary'] as string | null) ?? '')
          : ((d['summary'] as string | null) ?? '');
        text = summary ? tr('action', { step: name, summary }) : tr('action_plain', { step: name });
        if (d['outcome'] && d['outcome'] !== 'ok') text += ` (${outcomeLabel(this.translate, String(d['outcome']))})`;
        if (d['failed']) tone = 'warning';
        break;
      }
      case 'condition': {
        const taken = detail.definition?.graph.edges.find((e) => e.id === d['edge']);
        text = tr('condition', {
          step: name,
          branch: (d['branch'] as string | null) || (taken ? this.edgeCaption(taken, 'condition') : d['isDefault'] ? this.translate.instant('workflow_engine.designer.otherwise') : '—'),
          next: (d['nextNodeName'] as string | null) || node(t.toNodeId),
        });
        break;
      }
      case 'timer_set':
        text = tr('timer_set', { step: name, until: d['wakeAt'] ? this.format.date(String(d['wakeAt']), 'dateTime') : '—' });
        break;
      case 'timer_fired':
        text = tr('timer_fired', { step: name });
        break;
      case 'escalated':
        text = tr('escalated', { step: name });
        tone = 'warning';
        break;
      case 'completed':
        text = d['result'] ? tr('completed', { result: d['result'] as string }) : tr('completed_plain');
        tone = 'ok';
        break;
      case 'cancelled':
        text = actor ? tr('cancelled', { actor }) : tr('cancelled_auto');
        comment = (d['reason'] as string | null) ?? null;
        tone = 'danger';
        break;
      case 'retried':
        text = tr('retried', { actor: actor ?? '—' });
        tone = 'info';
        break;
      case 'error':
        text = tr('error', { message: this.failureOf(d) });
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
