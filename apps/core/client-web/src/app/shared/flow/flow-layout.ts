/**
 * A layered left-to-right layout for a directed graph — the shape SAP draws a document flow in, and
 * the one a workflow reads best: base documents on the left, what they became to the right.
 *
 * It is a small Sugiyama-style layout: assign each node to a layer by its longest path from a
 * source, order nodes within a layer by the average position of their predecessors (one pass, which
 * removes most crossings without the cost of the full algorithm), then place them on a grid and
 * centre each layer against the tallest one. It is pure — no DOM, no framework — so both the
 * relationship map and the workflow runtime view share it.
 *
 * Cycles cannot arise in a document flow, but the layering is written not to loop on one anyway: the
 * relaxation runs a bounded number of passes rather than until a fixed point.
 */

export interface FlowLayoutEdge {
  from: string;
  to: string;
}

export interface FlowPosition {
  x: number;
  y: number;
}

export interface FlowLayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  /** Horizontal gap between layers. */
  hGap?: number;
  /** Vertical gap between nodes in a layer. */
  vGap?: number;
}

export function layeredLayout(
  nodeKeys: string[],
  edges: FlowLayoutEdge[],
  options: FlowLayoutOptions = {},
): Map<string, FlowPosition> {
  const nodeWidth = options.nodeWidth ?? 248;
  const nodeHeight = options.nodeHeight ?? 132;
  const hGap = options.hGap ?? 104;
  const vGap = options.vGap ?? 28;

  const known = new Set(nodeKeys);
  const livingEdges = edges.filter((edge) => known.has(edge.from) && known.has(edge.to));

  // ── Layer assignment: longest path from the sources ────────────────────────
  const layer = new Map<string, number>(nodeKeys.map((key) => [key, 0]));
  const maxPasses = nodeKeys.length + 1;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    for (const edge of livingEdges) {
      const want = layer.get(edge.from)! + 1;
      if (want > layer.get(edge.to)!) {
        layer.set(edge.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // ── Group by layer, preserving first-seen order ─────────────────────────────
  const layers = new Map<number, string[]>();
  for (const key of nodeKeys) {
    const index = layer.get(key)!;
    const bucket = layers.get(index);
    if (bucket) bucket.push(key);
    else layers.set(index, [key]);
  }
  const layerIndices = [...layers.keys()].sort((a, b) => a - b);

  // ── Reduce crossings: order each layer by the mean order of its predecessors ─
  const predecessors = new Map<string, string[]>(nodeKeys.map((key) => [key, []]));
  for (const edge of livingEdges) predecessors.get(edge.to)!.push(edge.from);

  const orderIndex = new Map<string, number>();
  for (const index of layerIndices) {
    layers.get(index)!.forEach((key, i) => orderIndex.set(key, i));
  }
  for (let i = 1; i < layerIndices.length; i += 1) {
    const bucket = layers.get(layerIndices[i])!;
    const barycentre = (key: string): number => {
      const preds = predecessors.get(key)!;
      if (preds.length === 0) return orderIndex.get(key)!;
      return preds.reduce((sum, p) => sum + (orderIndex.get(p) ?? 0), 0) / preds.length;
    };
    bucket.sort((a, b) => barycentre(a) - barycentre(b));
    bucket.forEach((key, idx) => orderIndex.set(key, idx));
  }

  // ── Coordinates, centring every layer against the tallest ───────────────────
  const tallest = Math.max(1, ...layerIndices.map((index) => layers.get(index)!.length));
  const axisHeight = tallest * nodeHeight + (tallest - 1) * vGap;

  const positions = new Map<string, FlowPosition>();
  for (const index of layerIndices) {
    const bucket = layers.get(index)!;
    const height = bucket.length * nodeHeight + (bucket.length - 1) * vGap;
    const startY = (axisHeight - height) / 2;
    bucket.forEach((key, i) => {
      positions.set(key, {
        x: index * (nodeWidth + hGap),
        y: startY + i * (nodeHeight + vGap),
      });
    });
  }
  return positions;
}
