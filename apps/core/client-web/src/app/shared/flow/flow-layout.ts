/**
 * A layered left-to-right layout for a directed graph — the shape SAP draws a document flow in, and
 * the one a workflow reads best: base documents on the left, what they became to the right.
 *
 * It is a compact Sugiyama-style layout:
 *
 *  1. **Cycle removal.** A depth-first walk marks back edges; they are reversed for layering only.
 *     A document flow should be acyclic, but data is data (two entries that each name the other as
 *     their modification), and a layout must never loop or stretch a cycle across the screen.
 *  2. **Layering** by longest path from the sources (Kahn's order over the acyclic graph), so every
 *     edge points rightwards.
 *  3. **Crossing reduction**: alternating downward and upward sweeps, each ordering a layer by the
 *     mean position of its neighbours in the layer just placed (the barycentre heuristic).
 *  4. **Placement** on a grid, each layer centred against the tallest.
 *
 * It is pure — no DOM, no framework — so both the relationship map and the workflow runtime view
 * share it, and it is unit-tested on its own.
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
  /** Crossing-reduction sweeps (each is one down + one up pass). */
  sweeps?: number;
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
  const sweeps = options.sweeps ?? 4;

  const keys = [...new Set(nodeKeys)];
  const known = new Set(keys);
  const seenEdges = new Set<string>();
  const living = edges.filter((edge) => {
    if (!known.has(edge.from) || !known.has(edge.to) || edge.from === edge.to) return false;
    const id = `${edge.from}\u0000${edge.to}`;
    if (seenEdges.has(id)) return false;
    seenEdges.add(id);
    return true;
  });

  const acyclic = removeCycles(keys, living);
  const layer = assignLayers(keys, acyclic);

  // ── Group by layer, preserving first-seen order ─────────────────────────────
  const layers = new Map<number, string[]>();
  for (const key of keys) {
    const index = layer.get(key)!;
    const bucket = layers.get(index);
    if (bucket) bucket.push(key);
    else layers.set(index, [key]);
  }
  const order = [...layers.keys()].sort((a, b) => a - b).map((index) => layers.get(index)!);

  reduceCrossings(order, acyclic, sweeps);

  // ── Coordinates, centring every layer against the tallest ───────────────────
  const tallest = Math.max(1, ...order.map((bucket) => bucket.length));
  const axisHeight = tallest * nodeHeight + (tallest - 1) * vGap;

  const positions = new Map<string, FlowPosition>();
  order.forEach((bucket, column) => {
    const height = bucket.length * nodeHeight + (bucket.length - 1) * vGap;
    const startY = (axisHeight - height) / 2;
    bucket.forEach((key, row) => {
      positions.set(key, { x: column * (nodeWidth + hGap), y: startY + row * (nodeHeight + vGap) });
    });
  });
  return positions;
}

/** The edges with every back edge (found by an iterative DFS) reversed. */
function removeCycles(keys: string[], edges: FlowLayoutEdge[]): FlowLayoutEdge[] {
  const out = new Map<string, string[]>(keys.map((key) => [key, []]));
  for (const edge of edges) out.get(edge.from)!.push(edge.to);

  const state = new Map<string, 0 | 1 | 2>(); // 0 unvisited, 1 on stack, 2 done
  const back = new Set<string>();
  for (const start of keys) {
    if (state.get(start)) continue;
    const stack: Array<{ key: string; next: number }> = [{ key: start, next: 0 }];
    state.set(start, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const targets = out.get(frame.key)!;
      if (frame.next < targets.length) {
        const to = targets[frame.next++];
        const s = state.get(to) ?? 0;
        if (s === 1) back.add(`${frame.key}\u0000${to}`);
        else if (s === 0) {
          state.set(to, 1);
          stack.push({ key: to, next: 0 });
        }
      } else {
        state.set(frame.key, 2);
        stack.pop();
      }
    }
  }
  return edges.map((edge) =>
    back.has(`${edge.from}\u0000${edge.to}`) ? { from: edge.to, to: edge.from } : edge,
  );
}

/** Longest path from the sources over an acyclic edge set, in Kahn's order. */
function assignLayers(keys: string[], edges: FlowLayoutEdge[]): Map<string, number> {
  const layer = new Map<string, number>(keys.map((key) => [key, 0]));
  const indegree = new Map<string, number>(keys.map((key) => [key, 0]));
  const out = new Map<string, string[]>(keys.map((key) => [key, []]));
  for (const edge of edges) {
    out.get(edge.from)!.push(edge.to);
    indegree.set(edge.to, indegree.get(edge.to)! + 1);
  }
  const queue = keys.filter((key) => indegree.get(key) === 0);
  for (let head = 0; head < queue.length; head += 1) {
    const key = queue[head];
    for (const to of out.get(key)!) {
      layer.set(to, Math.max(layer.get(to)!, layer.get(key)! + 1));
      indegree.set(to, indegree.get(to)! - 1);
      if (indegree.get(to) === 0) queue.push(to);
    }
  }
  return layer;
}

/** Barycentre sweeps, in place. */
function reduceCrossings(order: string[][], edges: FlowLayoutEdge[], sweeps: number): void {
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const edge of edges) {
    (preds.get(edge.to) ?? preds.set(edge.to, []).get(edge.to)!).push(edge.from);
    (succs.get(edge.from) ?? succs.set(edge.from, []).get(edge.from)!).push(edge.to);
  }
  const position = new Map<string, number>();
  const index = () => order.forEach((bucket) => bucket.forEach((key, i) => position.set(key, i)));
  index();

  const sortBy = (bucket: string[], neighbours: Map<string, string[]>) => {
    const score = new Map<string, number>();
    for (const key of bucket) {
      const around = (neighbours.get(key) ?? []).filter((n) => position.has(n));
      score.set(
        key,
        around.length ? around.reduce((sum, n) => sum + position.get(n)!, 0) / around.length : position.get(key)!,
      );
    }
    // Stable: ties keep their current order.
    bucket.sort((a, b) => score.get(a)! - score.get(b)! || position.get(a)! - position.get(b)!);
    bucket.forEach((key, i) => position.set(key, i));
  };

  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    for (let i = 1; i < order.length; i += 1) sortBy(order[i], preds);
    for (let i = order.length - 2; i >= 0; i -= 1) sortBy(order[i], succs);
  }
}

/** Count edge crossings between adjacent layers — exposed for tests and diagnostics. */
export function countCrossings(positions: Map<string, FlowPosition>, edges: FlowLayoutEdge[]): number {
  const segments = edges
    .filter((edge) => positions.has(edge.from) && positions.has(edge.to))
    .map((edge) => ({ a: positions.get(edge.from)!, b: positions.get(edge.to)! }));
  let crossings = 0;
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const s = segments[i];
      const t = segments[j];
      if (s.a.x !== t.a.x || s.b.x !== t.b.x) continue;
      if ((s.a.y - t.a.y) * (s.b.y - t.b.y) < 0) crossings += 1;
    }
  }
  return crossings;
}
