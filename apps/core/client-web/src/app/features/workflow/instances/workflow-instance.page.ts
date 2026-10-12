import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  LucideAngularModule,
  ArrowLeft,
  Ban,
  CircleDot,
  Clock,
  GitBranch,
  Square,
  UserCheck,
  Zap,
} from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { FlowCanvasComponent, FlowCanvasEdge, FlowCanvasNode, layeredLayout } from '../../../shared/flow';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import {
  WorkflowGraphNode,
  WorkflowInstanceDetail,
  WorkflowNodeType,
  WorkflowService,
} from '../data/workflow.service';

/** A node of the definition graph, carrying the live state of this instance for the diagram. */
interface RuntimeNodeData {
  node: WorkflowGraphNode;
  state: 'current' | 'done' | 'idle';
}

/**
 * The runtime view of one instance: its process drawn with the path it has taken.
 *
 * The same shared canvas as the Relationship Map renders the definition's graph; each node is
 * coloured by where the instance is — the nodes that hold a live token are «current», the ones it
 * has already passed are «done», the rest are idle. Beside it, the open tasks and the move-by-move
 * timeline say what it is waiting on and how it got here.
 */
@Component({
  selector: 'app-workflow-instance-page',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule, FlowCanvasComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './workflow-instance.page.scss',
  templateUrl: './workflow-instance.page.html',
})
export class WorkflowInstancePage {
  private readonly service = inject(WorkflowService);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly translate = inject(TranslateService);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  readonly id = input<string>('');

  readonly detail = signal<WorkflowInstanceDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  protected readonly BackIcon = ArrowLeft;
  protected readonly CancelIcon = Ban;

  private readonly nodeIcons: Record<WorkflowNodeType, unknown> = {
    start: CircleDot,
    end: Square,
    task: UserCheck,
    approval: UserCheck,
    condition: GitBranch,
    action: Zap,
    timer: Clock,
  };

  private readonly view = computed<{
    nodes: FlowCanvasNode<RuntimeNodeData>[];
    edges: FlowCanvasEdge[];
  }>(() => {
    const detail = this.detail();
    const graph = detail?.definition?.graph;
    if (!detail || !graph) return { nodes: [], edges: [] };

    const current = new Set(
      detail.instance.tokens.filter((t) => t.state !== 'done').map((t) => t.nodeId),
    );
    const visited = new Set<string>();
    for (const transition of detail.transitions) {
      if (transition.fromNodeId) visited.add(transition.fromNodeId);
      if (transition.toNodeId) visited.add(transition.toNodeId);
    }

    const positions = layeredLayout(
      graph.nodes.map((node) => node.id),
      graph.edges.map((edge) => ({ from: edge.from, to: edge.to })),
    );

    return {
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        position: node.position ?? positions.get(node.id) ?? { x: 0, y: 0 },
        data: {
          node,
          state: current.has(node.id) ? 'current' : visited.has(node.id) ? 'done' : 'idle',
        },
      })),
      edges: graph.edges.map((edge) => ({ id: edge.id, source: edge.from, target: edge.to })),
    };
  });

  readonly canvasNodes = computed(() => this.view().nodes);
  readonly canvasEdges = computed(() => this.view().edges);
  readonly openTasks = computed(() => this.detail()?.tasks.filter((task) => task.status === 'OPEN') ?? []);
  readonly isRunning = computed(() => this.detail()?.instance.status === 'RUNNING');

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) this.load(id);
    });
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.getInstance(id).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.loading.set(false);
        this.tab?.setTitle(
          detail.definition?.name ?? this.translate.instant('workflow_engine.nav.instances'),
        );
      },
      error: (err: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(err, 'workflow_engine.load_failed'));
        this.loading.set(false);
      },
    });
  }

  iconFor(type: WorkflowNodeType): unknown {
    return this.nodeIcons[type] ?? CircleDot;
  }

  nodeName(id: string | null): string {
    if (!id) return '';
    return this.detail()?.definition?.graph.nodes.find((node) => node.id === id)?.name ?? id;
  }

  transitionLabel(kind: string): string {
    return this.translate.instant(`workflow_engine.transition.${kind}`);
  }

  cancel(): void {
    const id = this.id();
    if (!id) return;
    this.service.cancelInstance(id).subscribe({
      next: () => {
        this.notifications.showSuccess('workflow_engine.instance_cancelled');
        this.load(id);
      },
      error: (err: unknown) => this.notifications.showHttpError(err, 'workflow_engine.save_failed'),
    });
  }

  back(): void {
    void this.router.navigateByUrl(this.tenancy.urlFor('workflow-instances'));
  }
}
