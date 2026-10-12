import { Injector, runInInjectionContext } from '@angular/core';
import { EFLayoutDirection } from '@foblex/flow';
import { WorkflowGraphEdge, WorkflowGraphNode, WorkflowPoint } from '../data/workflow.service';
import { NODE_HEIGHT, NODE_WIDTH } from './designer-store';

export type LayoutEngineName = 'dagre' | 'elk';
export type LayoutDirection = 'LR' | 'TB';

export interface LayoutRequest {
  engine: LayoutEngineName;
  direction: LayoutDirection;
  nodeGap?: number;
  layerGap?: number;
  /** Measured sizes from the canvas; the default card size otherwise. */
  sizes?: Map<string, { width: number; height: number }>;
}

/**
 * Arrange the steps automatically with Foblex's layout adapters.
 *
 * Both engines are loaded on demand — ELK alone is over a megabyte — so a designer that never
 * presses «auto-layout» never downloads them. Dagre is the quick, tidy default for processes;
 * ELK's layered algorithm routes dense graphs with fewer crossings. Lanes are not laid out: their
 * steps move and the author resizes the lane, which keeps the organisational grouping intact.
 */
export async function computeLayout(
  injector: Injector,
  nodes: readonly WorkflowGraphNode[],
  edges: readonly WorkflowGraphEdge[],
  request: LayoutRequest,
): Promise<Map<string, WorkflowPoint>> {
  const direction = request.direction === 'TB' ? EFLayoutDirection.TOP_BOTTOM : EFLayoutDirection.LEFT_RIGHT;
  const layoutNodes = nodes.map((node) => ({
    id: node.id,
    size: request.sizes?.get(node.id) ?? { width: NODE_WIDTH, height: NODE_HEIGHT },
  }));
  const ids = new Set(nodes.map((n) => n.id));
  const connections = edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ source: e.from, target: e.to }));
  const options = {
    direction,
    nodeGap: request.nodeGap ?? (request.direction === 'TB' ? 60 : 50),
    layerGap: request.layerGap ?? (request.direction === 'TB' ? 90 : 110),
  };

  let result: { nodes: Array<{ id: string; position: WorkflowPoint }> };
  if (request.engine === 'elk') {
    const { ElkLayoutEngine, EElkLayoutAlgorithm } = await import('@foblex/flow-elk-layout');
    const engine = runInInjectionContext(injector, () => new ElkLayoutEngine());
    result = await engine.calculate(layoutNodes, connections, { ...options, algorithm: EElkLayoutAlgorithm.LAYERED });
  } else {
    const { DagreLayoutEngine, EDagreLayoutAlgorithm } = await import('@foblex/flow-dagre-layout');
    const engine = runInInjectionContext(injector, () => new DagreLayoutEngine());
    result = await engine.calculate(layoutNodes, connections, { ...options, algorithm: EDagreLayoutAlgorithm.NETWORK_SIMPLEX });
  }

  // Keep the drawing where it was: shift the result so its top-left matches the old one's.
  const before = topLeft(nodes.map((n) => n.position ?? { x: 0, y: 0 }));
  const after = topLeft(result.nodes.map((n) => n.position));
  const dx = before.x - after.x;
  const dy = before.y - after.y;
  return new Map(result.nodes.map((n) => [n.id, { x: n.position.x + dx, y: n.position.y + dy }]));
}

function topLeft(points: WorkflowPoint[]): WorkflowPoint {
  if (!points.length) return { x: 0, y: 0 };
  return { x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)) };
}
