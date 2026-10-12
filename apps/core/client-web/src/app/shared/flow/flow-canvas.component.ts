import {
  ChangeDetectionStrategy,
  Component,
  TemplateRef,
  effect,
  input,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Maximize, Minus, Plus, Locate } from 'lucide-angular';
import {
  EFConnectableSide,
  EFConnectionBehavior,
  EFConnectionType,
  FCanvasComponent,
  FFlowModule,
} from '@foblex/flow';
import { FlowPosition } from './flow-layout';

/** A positioned node the canvas draws. `data` is handed back to the consumer's node template. */
export interface FlowCanvasNode<T = unknown> {
  id: string;
  position: FlowPosition;
  data: T;
}

/** A directed link between two nodes, by node id. */
export interface FlowCanvasEdge<E = unknown> {
  id: string;
  source: string;
  target: string;
  data?: E;
}

/**
 * A reusable flow surface built on Foblex Flow, shared by the Relationship Map and the Business
 * Workflow views.
 *
 * It owns the chrome — the pannable, zoomable canvas, the dotted background, the zoom/fit toolbar —
 * and nothing about any one domain. The consumer passes `nodes` (already positioned, usually by
 * {@link layeredLayout}) and `edges`, plus a node template that renders one node's `data`; the
 * template is instantiated inside the canvas, so Foblex finds each `fNode` as its own content and
 * the awkward content-projection path is avoided entirely.
 *
 * The map fits to the viewport once the nodes are in the DOM — after the server answers, not just on
 * first paint — because the data arrives asynchronously and a fit run against an empty canvas does
 * nothing.
 */
@Component({
  selector: 'vx-flow-canvas',
  standalone: true,
  imports: [NgTemplateOutlet, FFlowModule, LucideAngularModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./flow-canvas.component.scss'],
  template: `
    <div class="vx-flow-canvas">
      <f-flow fDraggable (fNodesRendered)="onNodesRendered()">
        <f-canvas fZoom>
          @if (background()) {
            <f-background>
              <f-circle-pattern />
            </f-background>
          }

          @for (node of nodes(); track node.id) {
            <div
              fNode
              [fNodeId]="node.id"
              [fNodePosition]="node.position"
              class="vx-flow-canvas__node"
            >
              <div
                class="vx-flow-canvas__port vx-flow-canvas__port--in"
                fNodeInput
                [fInputId]="node.id + ':in'"
                [fInputConnectableSide]="Left"
              ></div>

              <ng-container
                [ngTemplateOutlet]="nodeTemplate()"
                [ngTemplateOutletContext]="{ $implicit: node.data, node: node }"
              ></ng-container>

              <div
                class="vx-flow-canvas__port vx-flow-canvas__port--out"
                fNodeOutput
                [fOutputId]="node.id + ':out'"
                [fOutputConnectableSide]="Right"
              ></div>
            </div>
          }

          @for (edge of edges(); track edge.id) {
            <f-connection
              [fConnectionId]="edge.id"
              [fOutputId]="edge.source + ':out'"
              [fInputId]="edge.target + ':in'"
              [fBehavior]="Fixed"
              [fType]="Segment"
            ></f-connection>
          }
        </f-canvas>
      </f-flow>

      <div class="vx-flow-canvas__toolbar" role="toolbar">
        <button
          type="button"
          class="vx-flow-canvas__btn"
          (click)="zoomIn()"
          [attr.aria-label]="'relationship_map.toolbar.zoom_in' | translate"
          [title]="'relationship_map.toolbar.zoom_in' | translate"
        >
          <lucide-icon [img]="ZoomInIcon" [size]="18" />
        </button>
        <button
          type="button"
          class="vx-flow-canvas__btn"
          (click)="zoomOut()"
          [attr.aria-label]="'relationship_map.toolbar.zoom_out' | translate"
          [title]="'relationship_map.toolbar.zoom_out' | translate"
        >
          <lucide-icon [img]="ZoomOutIcon" [size]="18" />
        </button>
        <button
          type="button"
          class="vx-flow-canvas__btn"
          (click)="fit()"
          [attr.aria-label]="'relationship_map.toolbar.fit' | translate"
          [title]="'relationship_map.toolbar.fit' | translate"
        >
          <lucide-icon [img]="FitIcon" [size]="18" />
        </button>
        <button
          type="button"
          class="vx-flow-canvas__btn"
          (click)="reset()"
          [attr.aria-label]="'relationship_map.toolbar.reset' | translate"
          [title]="'relationship_map.toolbar.reset' | translate"
        >
          <lucide-icon [img]="ResetIcon" [size]="18" />
        </button>
      </div>
    </div>
  `,
})
export class FlowCanvasComponent {
  readonly nodes = input<FlowCanvasNode[]>([]);
  readonly edges = input<FlowCanvasEdge[]>([]);
  readonly nodeTemplate = input.required<TemplateRef<unknown>>();
  readonly background = input(true);

  private readonly canvas = viewChild(FCanvasComponent);

  protected readonly Left = EFConnectableSide.LEFT;
  protected readonly Right = EFConnectableSide.RIGHT;
  protected readonly Fixed = EFConnectionBehavior.FIXED;
  protected readonly Segment = EFConnectionType.SEGMENT;

  protected readonly ZoomInIcon = Plus;
  protected readonly ZoomOutIcon = Minus;
  protected readonly FitIcon = Maximize;
  protected readonly ResetIcon = Locate;

  /**
   * Viewport helpers measure the rendered nodes, so the first fit waits for Foblex to report them
   * (`fNodesRendered`) — fitting from an effect ran before that and triggered FF1009, leaving the
   * initial view wrong. Later node sets (a new search) refit once the first render has happened.
   */
  private rendered = false;

  constructor() {
    effect(() => {
      if (this.nodes().length > 0 && this.rendered) this.scheduleFit();
    });
  }

  onNodesRendered(): void {
    this.rendered = true;
    this.scheduleFit();
  }

  /** Two frames out: Foblex measures nodes after the first, so one frame is a fit against stale rects. */
  scheduleFit(): void {
    requestAnimationFrame(() => requestAnimationFrame(() => this.fit()));
  }

  fit(): void {
    this.canvas()?.fitToScreen({ x: 64, y: 64 }, false);
  }

  zoomIn(): void {
    const canvas = this.canvas();
    if (canvas) canvas.setScale(Math.min(canvas.getScale() * 1.2, 3));
  }

  zoomOut(): void {
    const canvas = this.canvas();
    if (canvas) canvas.setScale(Math.max(canvas.getScale() / 1.2, 0.1));
  }

  reset(): void {
    this.canvas()?.resetScaleAndCenter(false);
  }
}
