import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
  LucideAngularModule,
  ArrowLeft,
  CircleDot,
  Clock,
  GitBranch,
  Play,
  Save,
  Send,
  Square,
  Trash2,
  UserCheck,
  Zap,
} from 'lucide-angular';
import {
  EFConnectableSide,
  EFConnectionBehavior,
  EFConnectionType,
  FCreateConnectionEvent,
  FFlowModule,
  FMoveNodesEvent,
} from '@foblex/flow';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import {
  WorkflowActionCatalogueItem,
  WorkflowDefinition,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowNodeType,
  WorkflowPredicate,
  WorkflowService,
  WorkflowTrigger,
} from '../data/workflow.service';

/** A single comparison row in the condition editor. The panel composes these into an `all` predicate. */
interface ConditionLeaf {
  var: string;
  op: string;
  value: string;
}

const NODE_SEEDS: Array<{ type: WorkflowNodeType; icon: unknown }> = [
  { type: 'task', icon: UserCheck },
  { type: 'approval', icon: UserCheck },
  { type: 'condition', icon: GitBranch },
  { type: 'action', icon: Zap },
  { type: 'timer', icon: Clock },
  { type: 'end', icon: Square },
];

/**
 * The visual workflow designer — a Foblex Flow canvas where a process is drawn.
 *
 * Nodes are placed from the palette and wired by dragging between their connectors; the panel on
 * the right edits whichever node is selected and the connections leaving it — a task's assignee and
 * outcomes, an action's parameters, a gateway's branch conditions. Only a draft is editable; a
 * published process opens read-only, with «new version» the way to revise it, so the design a
 * running instance depends on never changes under it.
 */
@Component({
  selector: 'app-workflow-designer-page',
  standalone: true,
  imports: [FormsModule, TranslateModule, LucideAngularModule, FFlowModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workflow-designer.page.html',
  styleUrl: './workflow-designer.page.scss',
})
export class WorkflowDesignerPage {
  private readonly service = inject(WorkflowService);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  readonly id = input<string>('');

  readonly definition = signal<WorkflowDefinition | null>(null);
  readonly name = signal('');
  readonly description = signal('');
  readonly nodes = signal<WorkflowGraphNode[]>([]);
  readonly edges = signal<WorkflowGraphEdge[]>([]);
  readonly trigger = signal<WorkflowTrigger>({ mode: 'manual' });
  readonly actions = signal<WorkflowActionCatalogueItem[]>([]);

  readonly selectedNodeId = signal<string | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly readOnly = computed(() => this.definition()?.status !== 'DRAFT');
  readonly selectedNode = computed(() => this.nodes().find((node) => node.id === this.selectedNodeId()) ?? null);
  readonly outgoing = computed(() => this.edges().filter((edge) => edge.from === this.selectedNodeId()));

  // Palette + Foblex enums for the template.
  protected readonly palette = NODE_SEEDS;
  protected readonly nodeTypes: WorkflowNodeType[] = ['start', 'end', 'task', 'approval', 'condition', 'action', 'timer'];
  protected readonly conditionOps = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'contains', 'exists', 'truthy'];
  protected readonly Left = EFConnectableSide.LEFT;
  protected readonly Right = EFConnectableSide.RIGHT;
  protected readonly Fixed = EFConnectionBehavior.FIXED;
  protected readonly Segment = EFConnectionType.SEGMENT;

  protected readonly BackIcon = ArrowLeft;
  protected readonly SaveIcon = Save;
  protected readonly PublishIcon = Send;
  protected readonly VersionIcon = Play;
  protected readonly DeleteIcon = Trash2;

  private readonly nodeIcons: Record<WorkflowNodeType, unknown> = {
    start: CircleDot,
    end: Square,
    task: UserCheck,
    approval: UserCheck,
    condition: GitBranch,
    action: Zap,
    timer: Clock,
  };

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) this.load(id);
    });
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.getDefinition(id).subscribe({
      next: (definition) => {
        this.definition.set(definition);
        this.name.set(definition.name);
        this.description.set(definition.description ?? '');
        this.trigger.set(definition.trigger ?? { mode: 'manual' });
        const graph = definition.graph ?? { nodes: [], edges: [] };
        this.nodes.set(graph.nodes.length ? graph.nodes.map(withPosition) : this.seedGraph());
        this.edges.set(graph.edges ?? []);
        this.loading.set(false);
        this.tab?.setTitle(definition.name);
      },
      error: (err: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(err, 'workflow_engine.load_failed'));
        this.loading.set(false);
      },
    });
    this.service.actions().subscribe({ next: (actions) => this.actions.set(actions) });
  }

  /** A fresh graph gets a start and an end so the author has a beginning and a target to wire to. */
  private seedGraph(): WorkflowGraphNode[] {
    return [
      { id: newId(), type: 'start', position: { x: 80, y: 160 } },
      { id: newId(), type: 'end', position: { x: 640, y: 160 } },
    ];
  }

  iconFor(type: WorkflowNodeType): unknown {
    return this.nodeIcons[type] ?? CircleDot;
  }

  // ── Palette ──────────────────────────────────────────────────────────────────

  addNode(type: WorkflowNodeType): void {
    if (this.readOnly()) return;
    const count = this.nodes().length;
    const node: WorkflowGraphNode = {
      id: newId(),
      type,
      // No default name: the card shows the translated type label until the author names it.
      position: { x: 160 + (count % 4) * 240, y: 80 + Math.floor(count / 4) * 170 },
      config: type === 'approval' ? { outcomes: ['approve', 'reject'] } : {},
    };
    this.nodes.update((nodes) => [...nodes, node]);
    this.selectedNodeId.set(node.id);
  }

  // ── Canvas events ──────────────────────────────────────────────────────────────

  onCreateConnection(event: FCreateConnectionEvent): void {
    if (this.readOnly() || !event.targetId) return;
    const from = nodeIdOf(event.sourceId);
    const to = nodeIdOf(event.targetId);
    if (!from || !to || from === to) return;
    if (this.edges().some((edge) => edge.from === from && edge.to === to)) return;
    this.edges.update((edges) => [...edges, { id: newId(), from, to }]);
  }

  onMoveNodes(event: FMoveNodesEvent): void {
    const moved = new Map(event.nodes.map((node) => [node.id, node.position]));
    this.nodes.update((nodes) =>
      nodes.map((node) => (moved.has(node.id) ? { ...node, position: moved.get(node.id)! } : node)),
    );
  }

  selectNode(id: string): void {
    this.selectedNodeId.set(id);
  }

  // ── Node edits ──────────────────────────────────────────────────────────────

  setNodeName(value: string): void {
    this.patchNode({ name: value });
  }

  setNodeConfig(patch: Partial<WorkflowGraphNode['config']>): void {
    const node = this.selectedNode();
    if (!node) return;
    this.patchNode({ config: { ...(node.config ?? {}), ...patch } });
  }

  setOutcomes(csv: string): void {
    const outcomes = csv.split(',').map((item) => item.trim()).filter(Boolean);
    this.setNodeConfig({ outcomes });
  }

  outcomesCsv(node: WorkflowGraphNode): string {
    return (node.config?.outcomes ?? []).join(', ');
  }

  private patchNode(patch: Partial<WorkflowGraphNode>): void {
    const id = this.selectedNodeId();
    if (!id) return;
    this.nodes.update((nodes) => nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)));
  }

  deleteNode(id: string): void {
    if (this.readOnly()) return;
    this.nodes.update((nodes) => nodes.filter((node) => node.id !== id));
    this.edges.update((edges) => edges.filter((edge) => edge.from !== id && edge.to !== id));
    if (this.selectedNodeId() === id) this.selectedNodeId.set(null);
  }

  // ── Edge edits ──────────────────────────────────────────────────────────────

  nodeName(id: string): string {
    return this.nodes().find((node) => node.id === id)?.name ?? id;
  }

  updateEdge(id: string, patch: Partial<WorkflowGraphEdge>): void {
    this.edges.update((edges) => edges.map((edge) => (edge.id === id ? { ...edge, ...patch } : edge)));
  }

  deleteEdge(id: string): void {
    this.edges.update((edges) => edges.filter((edge) => edge.id !== id));
  }

  // Condition editor — a flat list of comparisons combined with AND.
  leaves(edge: WorkflowGraphEdge): ConditionLeaf[] {
    const condition = edge.condition;
    if (condition && 'all' in condition) {
      return condition.all
        .filter((part): part is Extract<WorkflowPredicate, { var: string }> => 'var' in part)
        .map((part) => ({ var: part.var, op: part.op, value: stringifyValue(part.value) }));
    }
    return [];
  }

  addLeaf(edge: WorkflowGraphEdge): void {
    this.writeLeaves(edge, [...this.leaves(edge), { var: '', op: 'eq', value: '' }]);
  }

  setLeaf(edge: WorkflowGraphEdge, index: number, patch: Partial<ConditionLeaf>): void {
    const leaves = this.leaves(edge).map((leaf, i) => (i === index ? { ...leaf, ...patch } : leaf));
    this.writeLeaves(edge, leaves);
  }

  removeLeaf(edge: WorkflowGraphEdge, index: number): void {
    this.writeLeaves(edge, this.leaves(edge).filter((_, i) => i !== index));
  }

  private writeLeaves(edge: WorkflowGraphEdge, leaves: ConditionLeaf[]): void {
    const usable = leaves.filter((leaf) => leaf.var.trim());
    const condition: WorkflowPredicate | undefined = usable.length
      ? {
          all: usable.map((leaf) => ({
            var: leaf.var.trim(),
            op: leaf.op as 'eq',
            value: parseValue(leaf.value),
          })),
        }
      : undefined;
    this.updateEdge(edge.id, { condition });
  }

  // ── Save / publish ──────────────────────────────────────────────────────────

  save(afterPublish = false): void {
    const id = this.id();
    if (!id || this.readOnly()) return;
    this.saving.set(true);
    this.service
      .updateDefinition(id, {
        name: this.name().trim() || this.definition()?.name || this.id(),
        description: this.description() || null,
        graph: { nodes: this.nodes(), edges: this.edges() },
        trigger: this.trigger(),
      })
      .subscribe({
        next: (definition) => {
          this.definition.set(definition);
          this.saving.set(false);
          if (afterPublish) this.doPublish(id);
          else this.notifications.showSuccess('workflow_engine.saved');
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.notifications.showHttpError(err, 'workflow_engine.save_failed');
        },
      });
  }

  publish(): void {
    this.save(true);
  }

  private doPublish(id: string): void {
    this.service.publish(id).subscribe({
      next: (definition) => {
        this.definition.set(definition);
        this.notifications.showSuccess('workflow_engine.published');
      },
      error: (err: unknown) => this.notifications.showHttpError(err, 'workflow_engine.publish_failed'),
    });
  }

  newVersion(): void {
    const definition = this.definition();
    if (!definition) return;
    this.service.newVersion(definition.id).subscribe({
      next: (draft) => this.router.navigateByUrl(this.tenancy.urlFor(`workflows/${draft.id}/edit`)),
      error: (err: unknown) => this.notifications.showHttpError(err, 'workflow_engine.save_failed'),
    });
  }

  setTriggerMode(mode: 'manual' | 'event'): void {
    this.trigger.update((trigger) => ({ ...trigger, mode }));
  }

  setTriggerEvent(event: string): void {
    this.trigger.update((trigger) => ({ ...trigger, event }));
  }

  back(): void {
    void this.router.navigateByUrl(this.tenancy.urlFor('workflows'));
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────────────

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `n_${Math.random().toString(36).slice(2)}`;
}

function nodeIdOf(connectorId: string): string {
  return connectorId.replace(/:(in|out)$/, '');
}

function withPosition(node: WorkflowGraphNode, index: number): WorkflowGraphNode {
  return node.position ? node : { ...node, position: { x: 160 + (index % 4) * 240, y: 80 + Math.floor(index / 4) * 170 } };
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}
