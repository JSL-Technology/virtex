import { VxPluralKeyPipe } from '@virteex/shared/ui-i18n';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  EFCanvasLayer,
  EFConnectableSide,
  EFConnectionBehavior,
  EFConnectionType,
  EFMarkerType,
  EFResizeHandleType,
  FCanvasChangeEvent,
  FCanvasComponent,
  FConnectionWaypointsChangedEvent,
  FCreateConnectionEvent,
  FCreateNodeEvent,
  FDropToGroupEvent,
  FFlowComponent,
  FFlowModule,
  FMoveNodesEvent,
  FReassignConnectionEvent,
  FSelectionChangeEvent,
  FZoomDirective,
} from '@foblex/flow';
import { AlertTriangle, CircleAlert, LucideAngularModule } from 'lucide-angular';
import { NODE_ICONS } from '../data/workflow-labels';
import { ConnectionStyle, WorkflowNodeType, WorkflowPoint } from '../data/workflow.service';
import { GRID, inputOf, nodeOfConnector, outputOf } from './designer-store';

/** What the canvas draws for a step — display values computed by the page. */
/** Below this a step's name is not legible on a laptop screen. */
const MIN_READABLE_SCALE = 0.7;

export interface CanvasNode {
  id: string;
  type: WorkflowNodeType;
  name: string;
  /** Second line: who does it, which action, how long it waits. */
  meta: string;
  position: WorkflowPoint;
  parentId?: string;
  issue?: 'error' | 'warning' | null;
  issueCount?: number;
  /** Faded by a search or filter. */
  dim?: boolean;
  /** Runtime view: how far the instance got here. */
  state?: 'done' | 'active' | 'waiting' | 'failed' | 'cancelled' | null;
  ariaLabel: string;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  tone: 'plain' | 'outcome' | 'condition' | 'fallback' | 'negative';
  waypoints?: WorkflowPoint[];
  issue?: 'error' | 'warning' | null;
  dim?: boolean;
  /** Runtime view: the instance went this way. */
  traversed?: boolean;
}

export interface CanvasGroup {
  id: string;
  name: string;
  position: WorkflowPoint;
  size: { width: number; height: number };
  color: string;
}

export interface CanvasPrefs {
  snap: boolean;
  guides: boolean;
  minimap: boolean;
  background: 'dots' | 'grid' | 'none';
  connectionsOnTop: boolean;
}

export interface CanvasSelection {
  nodes: string[];
  edges: string[];
  groups: string[];
}

export const DEFAULT_CANVAS_PREFS: CanvasPrefs = { snap: true, guides: true, minimap: true, background: 'dots', connectionsOnTop: false };

/** Above this many steps the canvas caches geometry instead of re-measuring every frame. */
const CACHE_THRESHOLD = 60;

/**
 * The process drawn with Foblex Flow.
 *
 * Purely presentational: it renders what it is given and reports what the user did — connect,
 * reassign, move, select, drop from the palette, bend a connection, drop into a lane — leaving
 * every decision to the page and its store. The same component draws the read-only run view,
 * where `state` and `traversed` colour the path the instance took.
 *
 * Uses: drag handles, connectors with a side per layout direction, drag-to-connect with a preview
 * and snapping, reassigning either end, waypoints, connection content, arrow markers, colour
 * on the travelled path, lanes with resize handles and drop-to-group, selection area, magnetic
 * lines and rectangles, grid snapping, auto-pan, minimap, background patterns, zoom limits,
 * (the travelled path is a solid animated stroke, not `f-connection-gradient`: an SVG gradient is
 * not painted on a perfectly horizontal line, whose bounding box has no height),
 * layer order, geometry cache for large graphs, and fit to screen once nodes are measured.
 */
@Component({
  selector: 'app-workflow-canvas',
  standalone: true,
  imports: [FFlowModule, TranslatePipe, VxPluralKeyPipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './workflow-canvas.component.scss',
  template: `
    <f-flow
      fDraggable
      [fCache]="cache()"
      [fDraggableDisabled]="interactionDisabled()"
      [fDropToGroup]="!readonly()"
      [vCellSize]="cell()"
      [hCellSize]="cell()"
      [fCellSizeWhileDragging]="prefs().snap"
      [class.wf-flow--readonly]="readonly()"
      [attr.aria-label]="ariaLabel()"
      (fNodesRendered)="onRendered()"
      (fCreateConnection)="onCreateConnection($event)"
      (fReassignConnection)="onReassignConnection($event)"
      (fMoveNodes)="onMoveNodes($event)"
      (fSelectionChange)="onSelectionChange($event)"
      (fDeleteSelected)="deleteRequested.emit()"
      (fCreateNode)="onCreateNode($event)"
      (fConnectionWaypointsChanged)="onWaypoints($event)"
      (fDropToGroup)="onDropToGroup($event)"
    >
      @if (prefs().background !== 'none') {
        <f-background>
          @if (prefs().background === 'dots') {
            <f-circle-pattern [radius]="1.2" />
          } @else {
            <f-rect-pattern [vSize]="gridSize" [hSize]="gridSize" />
          }
        </f-background>
      }

      <f-canvas
        fZoom
        [fZoomMinimum]="0.15"
        [fZoomMaximum]="2.5"
        [fZoomStep]="0.1"
        [fZoomDblClickStep]="0.4"
        [fLayers]="layers()"
        (fCanvasChange)="onCanvasChange($event)"
      >
        <f-connection-for-create [fType]="connectionType()" [fBehavior]="Fixed" [fRadius]="10" [fOffset]="24">
          <f-connection-marker-arrow [type]="MarkerEnd" />
        </f-connection-for-create>
        <f-snap-connection [fSnapThreshold]="48" [fType]="connectionType()" [fBehavior]="Fixed" [fRadius]="10" [fOffset]="24">
          <f-connection-marker-arrow [type]="MarkerEnd" />
        </f-snap-connection>

        @for (group of groups(); track group.id) {
          <div
            fGroup
            class="wf-lane"
            fDragHandle
            [fGroupId]="group.id"
            [fGroupPosition]="group.position"
            [fGroupSize]="group.size"
            [fGroupDraggingDisabled]="readonly()"
            [style.--wf-lane-color]="'var(--' + group.color + ')'"
            [attr.aria-label]="group.name"
            (fGroupSizeChange)="groupResized.emit({ id: group.id, size: { width: $event.width, height: $event.height } })"
          >
            <span class="wf-lane__title">{{ group.name }}</span>
            @if (!readonly()) {
              <div fResizeHandle [fResizeHandleType]="ResizeCorner" class="wf-lane__resize"></div>
            }
          </div>
        }

        @for (edge of edges(); track edge.id) {
          <f-connection
            [fConnectionId]="edge.id"
            [fSourceId]="outputOf(edge.from)"
            [fTargetId]="inputOf(edge.to)"
            [fType]="connectionType()"
            [fBehavior]="Fixed"
            [fRadius]="10"
            [fOffset]="24"
            [fReassignDisabled]="readonly()"
            [fSelectionDisabled]="runtime()"
            [class]="edgeClass(edge)"
          >
            <f-connection-marker-arrow [type]="MarkerEnd" />
            @if (edge.label) {
              <div fConnectionContent [position]="0.5" [class]="'wf-edge-label wf-edge-label--' + edge.tone" [title]="edge.label">
                {{ edge.label }}
              </div>
            }
            @if (!readonly() && edge.waypoints?.length) {
              <f-connection-waypoints [waypoints]="edge.waypoints!" [visibility]="true" />
            } @else if (!readonly()) {
              <f-connection-waypoints [waypoints]="[]" [visibility]="false" />
            }
          </f-connection>
        }

        @for (node of nodes(); track node.id) {
          <div
            fNode
            fDragHandle
            [fNodeId]="node.id"
            [fNodePosition]="node.position"
            [fNodeParentId]="node.parentId"
            [fNodeDraggingDisabled]="readonly()"
            [fNodeSelectionDisabled]="runtime()"
            [fConnectOnNode]="!readonly()"
            [fMinimapClass]="'wf-mini wf-mini--' + node.type"
            [class]="nodeClass(node)"
            [attr.aria-label]="node.ariaLabel"
            [attr.data-node-id]="node.id"
            (dblclick)="activate.emit(node.id)"
          >
            @if (node.type !== 'start') {
              <div
                fConnector
                fConnectorType="target"
                [class]="'wf-port wf-port--in ' + inSide()"
                [fConnectorId]="inputOf(node.id)"
                [fConnectorMultiple]="true"
                [fConnectorDisabled]="readonly()"
                [fConnectorConnectableSide]="inSide()"
              ></div>
            }
            <span class="wf-node__icon" aria-hidden="true">
              <lucide-icon [img]="icon(node.type)" [size]="16" />
            </span>
            <span class="wf-node__body">
              <span class="wf-node__name">{{ node.name }}</span>
              @if (node.meta) {
                <span class="wf-node__meta">{{ node.meta }}</span>
              }
            </span>
            @if (node.issue) {
              <span class="wf-node__issue" [class.wf-node__issue--error]="node.issue === 'error'" [title]="'workflow_engine.designer.issue_count' | vxPluralKey: node.issueCount ?? 0 | translate: { count: node.issueCount }">
                <lucide-icon [img]="node.issue === 'error' ? ErrorIcon : WarnIcon" [size]="12" />
                {{ node.issueCount }}
              </span>
            }
            @if (node.type !== 'end') {
              <div
                fConnector
                fConnectorType="source"
                [class]="'wf-port wf-port--out ' + outSide()"
                [fConnectorId]="outputOf(node.id)"
                [fConnectorMultiple]="true"
                [fConnectorDisabled]="readonly()"
                [fConnectorConnectableSide]="outSide()"
              ></div>
            }
          </div>
        }
      </f-canvas>

      <!-- One projectable node per @if: Foblex projects each into its own slot (NG8011). -->
      @if (!readonly()) {
        <f-selection-area />
      }
      @if (!readonly()) {
        <f-auto-pan [fEdgeThreshold]="48" [fSpeed]="12" />
      }
      @if (prefs().guides && !readonly()) {
        <f-magnetic-lines [threshold]="8" />
        <f-magnetic-rects />
      }
      @if (prefs().minimap) {
        <!-- Sized to the graph, not to a fixed world: a two-step process read as two dashes. -->
        <f-minimap [fMinSize]="900" />
      }
    </f-flow>
  `,
})
export class WorkflowCanvasComponent {
  private readonly translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly nodes = input<CanvasNode[]>([]);
  readonly edges = input<CanvasEdge[]>([]);
  readonly groups = input<CanvasGroup[]>([]);
  readonly connectionStyle = input<ConnectionStyle>('bezier');
  readonly direction = input<'LR' | 'TB'>('LR');
  readonly prefs = input<CanvasPrefs>(DEFAULT_CANVAS_PREFS);
  readonly readonly = input(false);
  /** Run view: nothing is draggable or selectable, the path is coloured. */
  readonly runtime = input(false);
  /** Selection the page wants shown (panel links, search, undo). */
  readonly selection = input<CanvasSelection>({ nodes: [], edges: [], groups: [] });

  readonly connect = output<{ from: string; to: string }>();
  readonly reassign = output<{ edgeId: string; from?: string; to?: string }>();
  readonly moved = output<Array<{ id: string; position: WorkflowPoint }>>();
  readonly selectionChange = output<CanvasSelection>();
  readonly deleteRequested = output<void>();
  readonly dropped = output<{ data: unknown; position: WorkflowPoint; groupId?: string }>();
  readonly waypointsChange = output<{ edgeId: string; points: WorkflowPoint[] }>();
  readonly droppedToGroup = output<{ groupId: string; nodeIds: string[] }>();
  readonly groupResized = output<{ id: string; size: { width: number; height: number } }>();
  readonly scaleChange = output<number>();
  readonly activate = output<string>();
  readonly rendered = output<void>();

  private readonly flow = viewChild(FFlowComponent);
  private readonly canvas = viewChild(FCanvasComponent);
  private readonly zoom = viewChild(FZoomDirective);

  /** The flow reports selection back after `select()`; this keeps that echo from looping. */
  private lastSelectionKey = '';
  private firstRender = true;
  readonly scale = signal(1);

  protected readonly Fixed = EFConnectionBehavior.FIXED;
  protected readonly MarkerEnd = EFMarkerType.END_ALL_STATES;
  protected readonly ResizeCorner = EFResizeHandleType.RIGHT_BOTTOM;
  protected readonly ErrorIcon = CircleAlert;
  protected readonly WarnIcon = AlertTriangle;
  protected readonly gridSize = GRID;
  protected readonly outputOf = outputOf;
  protected readonly inputOf = inputOf;

  readonly cache = computed(() => this.nodes().length > CACHE_THRESHOLD);
  readonly cell = computed(() => (this.prefs().snap ? GRID : 1));
  /**
   * Foblex listens for pointer events on the document, so a canvas in a background tab would also
   * react to a drag meant for the visible one. Only the canvas on screen is interactive.
   */
  private readonly visible = signal(true);
  readonly interactionDisabled = computed(() => this.runtime() || !this.visible());
  readonly inSide = computed(() => (this.direction() === 'TB' ? EFConnectableSide.TOP : EFConnectableSide.LEFT));
  readonly outSide = computed(() => (this.direction() === 'TB' ? EFConnectableSide.BOTTOM : EFConnectableSide.RIGHT));
  readonly layers = computed(() =>
    this.prefs().connectionsOnTop
      ? [EFCanvasLayer.GROUPS, EFCanvasLayer.NODES, EFCanvasLayer.CONNECTIONS]
      : [EFCanvasLayer.GROUPS, EFCanvasLayer.CONNECTIONS, EFCanvasLayer.NODES],
  );
  readonly connectionType = computed(() => {
    switch (this.connectionStyle()) {
      case 'segment':
        return EFConnectionType.SEGMENT;
      case 'straight':
        return EFConnectionType.STRAIGHT;
      case 'adaptive-curve':
        return EFConnectionType.ADAPTIVE_CURVE;
      default:
        return EFConnectionType.BEZIER;
    }
  });
  readonly ariaLabel = computed(() =>
    this.translate.instant('workflow_engine.designer.canvas_label', { nodes: this.nodes().length, edges: this.edges().length }),
  );

  constructor() {
    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver((entries) => this.visible.set(entries.some((e) => e.isIntersecting)));
      observer.observe(this.host.nativeElement);
      inject(DestroyRef).onDestroy(() => observer.disconnect());
    }

    // Mirror a selection made outside the canvas (panel, search, undo) into Foblex.
    effect(() => {
      const wanted = this.selection();
      const flow = this.flow();
      if (!flow) return;
      const key = selectionKey(wanted);
      if (key === this.lastSelectionKey) return;
      this.lastSelectionKey = key;
      untracked(() => {
        if (!wanted.nodes.length && !wanted.edges.length && !wanted.groups.length) flow.clearSelection();
        else flow.select([...wanted.nodes, ...wanted.groups], wanted.edges, false);
      });
    });
  }

  // ── Viewport ────────────────────────────────────────────────────────────────

  onRendered(): void {
    if (this.firstRender) {
      this.firstRender = false;
      // Never magnify a two-step draft to fill the screen, and never open a large one at a scale
      // where its cards cannot be read (QA M-10: the purchase template opened at 38 %).
      this.fitReadable(false);
    }
    this.rendered.emit();
  }

  /** «Fit to screen»: the whole drawing, at whatever scale it takes. An explicit request. */
  fit(): void {
    this.canvas()?.fitToScreen({ x: 80, y: 80 }, true, true, 1.25);
  }

  /**
   * Fit when the drawing is readable that way; otherwise open at a readable scale on the start step,
   * from where the author follows the flow (the minimap and «fit» still show the whole).
   */
  fitReadable(animated = true): void {
    const canvas = this.canvas();
    if (!canvas) return;
    canvas.fitToScreen({ x: 80, y: 80 }, false, true, 1);
    if (canvas.getScale() >= MIN_READABLE_SCALE) {
      if (animated) canvas.fitToScreen({ x: 80, y: 80 }, true, true, 1);
      return;
    }
    canvas.setScale(MIN_READABLE_SCALE);
    const start = this.nodes().find((node) => node.type === 'start') ?? this.nodes()[0];
    if (start) canvas.centerGroupOrNode(start.id, animated, true);
  }

  zoomIn(): void {
    this.zoom()?.zoomIn();
  }

  zoomOut(): void {
    this.zoom()?.zoomOut();
  }

  resetZoom(): void {
    this.canvas()?.resetScaleAndCenter(true);
  }

  center(id: string): void {
    this.canvas()?.centerGroupOrNode(id, true);
  }

  redraw(): void {
    this.flow()?.redraw();
  }

  /** The canvas point at the middle of the visible area — where a keyboard-added step goes. */
  viewportCenter(): WorkflowPoint {
    const flow = this.flow();
    const rect = this.host.nativeElement.getBoundingClientRect();
    if (!flow) return { x: 200, y: 200 };
    const inFlow = flow.getPositionInFlow({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    return { x: inFlow.x, y: inFlow.y };
  }

  /** Measured card sizes, so auto-layout spaces steps by what is actually drawn. */
  measuredSizes(): Map<string, { width: number; height: number }> {
    const sizes = new Map<string, { width: number; height: number }>();
    const scale = this.scale() || 1;
    this.host.nativeElement.querySelectorAll<HTMLElement>('[data-node-id]').forEach((element) => {
      const id = element.dataset['nodeId'];
      if (!id) return;
      const rect = element.getBoundingClientRect();
      sizes.set(id, { width: rect.width / scale, height: rect.height / scale });
    });
    return sizes;
  }

  onCanvasChange(event: FCanvasChangeEvent): void {
    this.scale.set(event.scale);
    this.scaleChange.emit(event.scale);
  }

  // ── Interaction events ──────────────────────────────────────────────────────

  onCreateConnection(event: FCreateConnectionEvent): void {
    if (!event.targetId || this.readonly()) return;
    this.connect.emit({ from: nodeOfConnector(event.sourceId), to: nodeOfConnector(event.targetId) });
  }

  onReassignConnection(event: FReassignConnectionEvent): void {
    if (this.readonly()) return;
    if (event.isSourceReassign) {
      if (!event.nextSourceId) return;
      this.reassign.emit({ edgeId: event.connectionId, from: nodeOfConnector(event.nextSourceId) });
    } else {
      if (!event.nextTargetId) return;
      this.reassign.emit({ edgeId: event.connectionId, to: nodeOfConnector(event.nextTargetId) });
    }
  }

  onMoveNodes(event: FMoveNodesEvent): void {
    if (this.readonly()) return;
    this.moved.emit(event.nodes.map((n) => ({ id: n.id, position: { x: n.position.x, y: n.position.y } })));
  }

  onSelectionChange(event: FSelectionChangeEvent): void {
    const groupIds = new Set(this.groups().map((g) => g.id));
    const selection: CanvasSelection = {
      nodes: event.nodeIds.filter((id) => !groupIds.has(id)),
      groups: [...event.groupIds, ...event.nodeIds.filter((id) => groupIds.has(id))],
      edges: event.connectionIds,
    };
    this.lastSelectionKey = selectionKey(selection);
    this.selectionChange.emit(selection);
  }

  onCreateNode(event: FCreateNodeEvent): void {
    if (this.readonly()) return;
    const groupIds = new Set(this.groups().map((g) => g.id));
    const container = event.targetContainerId ?? event.fTargetNode;
    this.dropped.emit({
      data: event.data,
      position: { x: event.rect.x, y: event.rect.y },
      groupId: container && groupIds.has(container) ? container : undefined,
    });
  }

  onWaypoints(event: FConnectionWaypointsChangedEvent): void {
    if (this.readonly()) return;
    this.waypointsChange.emit({ edgeId: event.connectionId, points: event.waypoints.map((p) => ({ x: p.x, y: p.y })) });
  }

  onDropToGroup(event: FDropToGroupEvent): void {
    if (this.readonly()) return;
    this.droppedToGroup.emit({ groupId: event.targetGroupId, nodeIds: event.nodeIds });
  }

  // ── Rendering helpers ───────────────────────────────────────────────────────

  icon(type: WorkflowNodeType): unknown {
    return NODE_ICONS[type];
  }

  nodeClass(node: CanvasNode): string {
    const classes = ['wf-node', `wf-node--${node.type}`];
    if (node.dim) classes.push('wf-node--dim');
    if (node.issue) classes.push(`wf-node--${node.issue}`);
    if (node.state) classes.push(`wf-node--${node.state}`);
    return classes.join(' ');
  }

  edgeClass(edge: CanvasEdge): string {
    const classes = ['wf-edge', `wf-edge--${edge.tone}`];
    if (edge.dim) classes.push('wf-edge--dim');
    if (edge.issue) classes.push(`wf-edge--${edge.issue}`);
    if (edge.traversed) classes.push('wf-edge--traversed');
    if (this.runtime() && !edge.traversed) classes.push('wf-edge--untaken');
    return classes.join(' ');
  }
}

function selectionKey(selection: CanvasSelection): string {
  return [selection.nodes.join(','), selection.edges.join(','), selection.groups.join(',')].join('|');
}
