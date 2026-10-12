import { Injectable, computed, signal } from '@angular/core';
import {
  WorkflowActionCatalogueItem,
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphGroup,
  WorkflowGraphNode,
  WorkflowGraphSettings,
  WorkflowNodeType,
  WorkflowPoint,
  WorkflowTrigger,
  WorkflowVariable,
} from '../data/workflow.service';

/** Everything the author can change, as one immutable value — what undo and redo move between. */
export interface DesignerDocument {
  name: string;
  description: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  groups: WorkflowGraphGroup[];
  variables: WorkflowVariable[];
  settings: WorkflowGraphSettings;
  trigger: WorkflowTrigger;
}

export interface DesignerSelection {
  nodes: string[];
  edges: string[];
  groups: string[];
}

/** Clipboard payload: a self-contained fragment of a graph. */
export interface DesignerClipboard {
  kind: 'virtex.workflow.fragment';
  version: 1;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  groups: WorkflowGraphGroup[];
}

export type ConnectResult = { ok: true; edge: WorkflowGraphEdge } | { ok: false; reasonKey: string };

const HISTORY_LIMIT = 200;
/** Consecutive edits of the same field within this window are one undo step, not one per keystroke. */
const COALESCE_MS = 900;
const PASTE_OFFSET = 40;

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 64;
export const GRID = 20;

const EMPTY: DesignerDocument = {
  name: '',
  description: '',
  nodes: [],
  edges: [],
  groups: [],
  variables: [],
  settings: { connectionType: 'bezier', layoutDirection: 'LR' },
  trigger: { mode: 'manual' },
};

export function newId(prefix = ''): string {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}${raw.slice(0, 8)}` : raw;
}

/** Connector ids carry the node id, so a connection can always be mapped back to its nodes. */
export const outputOf = (nodeId: string) => `${nodeId}:out`;
export const inputOf = (nodeId: string) => `${nodeId}:in`;
export const nodeOfConnector = (connectorId: string) => connectorId.replace(/:(in|out)$/, '');

/** The outcomes a node offers on its outgoing connections. */
export function outcomesOf(node: WorkflowGraphNode | undefined, actions: readonly WorkflowActionCatalogueItem[] = []): string[] {
  if (!node) return [];
  if (node.type === 'task' || node.type === 'approval') {
    const own = node.config?.outcomes?.filter(Boolean) ?? [];
    return own.length ? own : node.type === 'approval' ? ['approve', 'reject'] : ['done'];
  }
  if (node.type === 'action') return [...(actions.find((a) => a.key === node.config?.action)?.outcomes ?? [])];
  return [];
}

const snap = (value: number) => Math.round(value / GRID) * GRID;

/**
 * The designer's model: the drawing, its history and its selection.
 *
 * Provided per designer instance (each tab gets its own), it holds the document as a signal and
 * every change goes through {@link commit}, which records the previous state for undo. Edits typed
 * into a field coalesce by a key, so undo walks back by meaningful steps rather than by letters.
 * The canvas, the panels and the keyboard shortcuts all act through here, which is what keeps
 * selection, clipboard, undo and the server copy consistent with each other.
 */
@Injectable()
export class DesignerStore {
  readonly doc = signal<DesignerDocument>(EMPTY);
  readonly selection = signal<DesignerSelection>({ nodes: [], edges: [], groups: [] });

  private past: DesignerDocument[] = [];
  private future: DesignerDocument[] = [];
  private lastCoalesce: { key: string; at: number } | null = null;
  private readonly historyTick = signal(0);

  /** Bumped on every committed change; compared with the saved revision for «unsaved changes». */
  readonly revision = signal(0);
  readonly savedRevision = signal(0);
  readonly dirty = computed(() => this.revision() !== this.savedRevision());

  readonly canUndo = computed(() => (this.historyTick(), this.past.length > 0));
  readonly canRedo = computed(() => (this.historyTick(), this.future.length > 0));

  readonly nodes = computed(() => this.doc().nodes);
  readonly edges = computed(() => this.doc().edges);
  readonly groups = computed(() => this.doc().groups);
  readonly variables = computed(() => this.doc().variables);
  readonly settings = computed(() => this.doc().settings);
  readonly trigger = computed(() => this.doc().trigger);

  readonly nodeById = computed(() => new Map(this.nodes().map((node) => [node.id, node])));
  readonly selectedNodes = computed(() => {
    const ids = new Set(this.selection().nodes);
    return this.nodes().filter((node) => ids.has(node.id));
  });
  readonly selectedEdges = computed(() => {
    const ids = new Set(this.selection().edges);
    return this.edges().filter((edge) => ids.has(edge.id));
  });
  readonly selectedGroups = computed(() => {
    const ids = new Set(this.selection().groups);
    return this.groups().filter((group) => ids.has(group.id));
  });
  readonly hasSelection = computed(() => {
    const s = this.selection();
    return s.nodes.length + s.edges.length + s.groups.length > 0;
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  load(document: Partial<DesignerDocument>): void {
    this.doc.set(normalize({ ...EMPTY, ...document }));
    this.past = [];
    this.future = [];
    this.lastCoalesce = null;
    this.historyTick.update((n) => n + 1);
    this.selection.set({ nodes: [], edges: [], groups: [] });
    this.revision.set(0);
    this.savedRevision.set(0);
  }

  markSaved(revision = this.revision()): void {
    this.savedRevision.set(revision);
  }

  toGraph(): WorkflowGraph {
    const d = this.doc();
    return { nodes: d.nodes, edges: d.edges, groups: d.groups, variables: d.variables, settings: d.settings };
  }

  // ── History ─────────────────────────────────────────────────────────────────

  /**
   * Apply a change. `coalesceKey` merges consecutive changes with the same key (typing into one
   * field) into a single undo step.
   */
  commit(change: (doc: DesignerDocument) => DesignerDocument, coalesceKey?: string): void {
    const before = this.doc();
    const after = change(before);
    if (after === before) return;
    const now = Date.now();
    const coalesce = !!coalesceKey && this.lastCoalesce?.key === coalesceKey && now - this.lastCoalesce.at < COALESCE_MS;
    if (!coalesce) {
      this.past.push(before);
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.lastCoalesce = coalesceKey ? { key: coalesceKey, at: now } : null;
    this.future = [];
    this.doc.set(after);
    this.revision.update((r) => r + 1);
    this.historyTick.update((n) => n + 1);
  }

  undo(): void {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.doc());
    this.doc.set(previous);
    this.lastCoalesce = null;
    this.pruneSelection();
    this.revision.update((r) => r + 1);
    this.historyTick.update((n) => n + 1);
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.doc());
    this.doc.set(next);
    this.lastCoalesce = null;
    this.pruneSelection();
    this.revision.update((r) => r + 1);
    this.historyTick.update((n) => n + 1);
  }

  // ── Selection ───────────────────────────────────────────────────────────────

  select(selection: Partial<DesignerSelection>): void {
    this.selection.set({ nodes: selection.nodes ?? [], edges: selection.edges ?? [], groups: selection.groups ?? [] });
  }

  clearSelection(): void {
    this.select({});
  }

  private pruneSelection(): void {
    const d = this.doc();
    const nodeIds = new Set(d.nodes.map((n) => n.id));
    const edgeIds = new Set(d.edges.map((e) => e.id));
    const groupIds = new Set(d.groups.map((g) => g.id));
    const s = this.selection();
    this.selection.set({
      nodes: s.nodes.filter((id) => nodeIds.has(id)),
      edges: s.edges.filter((id) => edgeIds.has(id)),
      groups: s.groups.filter((id) => groupIds.has(id)),
    });
  }

  // ── Document fields ─────────────────────────────────────────────────────────

  setName(name: string): void {
    this.commit((d) => (d.name === name ? d : { ...d, name }), 'doc:name');
  }

  setDescription(description: string): void {
    this.commit((d) => (d.description === description ? d : { ...d, description }), 'doc:description');
  }

  setTrigger(trigger: WorkflowTrigger, coalesceKey?: string): void {
    this.commit((d) => ({ ...d, trigger }), coalesceKey);
  }

  setSettings(patch: Partial<WorkflowGraphSettings>): void {
    this.commit((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  }

  setVariables(variables: WorkflowVariable[], coalesceKey?: string): void {
    this.commit((d) => ({ ...d, variables }), coalesceKey);
  }

  // ── Nodes ──────────────────────────────────────────────────────────────────

  addNode(type: WorkflowNodeType, position: WorkflowPoint, preset: Partial<WorkflowGraphNode> = {}): WorkflowGraphNode {
    const node: WorkflowGraphNode = {
      id: newId(),
      type,
      position: { x: snap(position.x), y: snap(position.y) },
      ...preset,
      config: { ...defaultConfig(type), ...(preset.config ?? {}) },
    };
    this.commit((d) => ({ ...d, nodes: [...d.nodes, node] }));
    this.select({ nodes: [node.id] });
    return node;
  }

  /**
   * Insert a node on an existing connection: `a → b` becomes `a → new → b`, keeping the original
   * connection's routing (outcome, condition, default) on the first half.
   */
  insertOnEdge(edgeId: string, type: WorkflowNodeType, preset: Partial<WorkflowGraphNode> = {}): WorkflowGraphNode | null {
    const edge = this.edges().find((e) => e.id === edgeId);
    if (!edge) return null;
    const from = this.nodeById().get(edge.from);
    const to = this.nodeById().get(edge.to);
    const position = {
      x: ((from?.position?.x ?? 0) + (to?.position?.x ?? 0)) / 2,
      y: ((from?.position?.y ?? 0) + (to?.position?.y ?? 0)) / 2,
    };
    const node: WorkflowGraphNode = { id: newId(), type, position, ...preset, config: { ...defaultConfig(type), ...(preset.config ?? {}) } };
    this.commit((d) => ({
      ...d,
      nodes: [...d.nodes, node],
      edges: [
        ...d.edges.filter((e) => e.id !== edgeId),
        { ...edge, id: newId(), to: node.id, waypoints: undefined },
        { id: newId(), from: node.id, to: edge.to },
      ],
    }));
    this.select({ nodes: [node.id] });
    return node;
  }

  patchNode(id: string, patch: Partial<WorkflowGraphNode>, coalesceKey?: string): void {
    this.commit(
      (d) => ({ ...d, nodes: d.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)) }),
      coalesceKey ? `node:${id}:${coalesceKey}` : undefined,
    );
  }

  patchNodeConfig(id: string, patch: Partial<NonNullable<WorkflowGraphNode['config']>>, coalesceKey?: string): void {
    this.commit(
      (d) => ({
        ...d,
        nodes: d.nodes.map((node) => (node.id === id ? { ...node, config: clean({ ...(node.config ?? {}), ...patch }) } : node)),
      }),
      coalesceKey ? `node:${id}:config:${coalesceKey}` : undefined,
    );
  }

  /** Persist positions after a drag; one undo step for the whole move. */
  moveNodes(moves: Array<{ id: string; position: WorkflowPoint }>): void {
    const byId = new Map(moves.map((m) => [m.id, m.position]));
    this.commit((d) => {
      let changed = false;
      const nodes = d.nodes.map((node) => {
        const position = byId.get(node.id);
        if (!position || (node.position?.x === position.x && node.position?.y === position.y)) return node;
        changed = true;
        return { ...node, position: { x: Math.round(position.x), y: Math.round(position.y) } };
      });
      const groups = d.groups.map((group) => {
        const position = byId.get(group.id);
        if (!position || (group.position?.x === position.x && group.position?.y === position.y)) return group;
        changed = true;
        return { ...group, position: { x: Math.round(position.x), y: Math.round(position.y) } };
      });
      return changed ? { ...d, nodes, groups } : d;
    });
  }

  /** Apply positions from auto-layout, as one undo step. */
  applyLayout(positions: Map<string, WorkflowPoint>): void {
    this.commit((d) => {
      const nodes = d.nodes.map((node) => {
        const position = positions.get(node.id);
        return position ? { ...node, position: { x: snap(position.x), y: snap(position.y) } } : node;
      });
      return {
        ...d,
        nodes,
        // Lanes follow their steps, so «arrange» never leaves a step outside the lane it belongs to.
        groups: d.groups.map((group) => fitGroup(group, nodes.filter((n) => n.parentId === group.id))),
        // Bend points drawn for the old layout would route the new one through empty space.
        edges: d.edges.map((edge) => (edge.waypoints?.length ? { ...edge, waypoints: undefined } : edge)),
      };
    });
  }

  // ── Groups (lanes) ─────────────────────────────────────────────────────────

  addGroup(position: WorkflowPoint, name: string): WorkflowGraphGroup {
    const group: WorkflowGraphGroup = { id: newId('g'), name, position: { x: snap(position.x), y: snap(position.y) }, size: { width: 720, height: 220 }, color: 'viz-1' };
    this.commit((d) => ({ ...d, groups: [...d.groups, group] }));
    this.select({ groups: [group.id] });
    return group;
  }

  patchGroup(id: string, patch: Partial<WorkflowGraphGroup>, coalesceKey?: string): void {
    this.commit((d) => ({ ...d, groups: d.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) }), coalesceKey ? `group:${id}:${coalesceKey}` : undefined);
  }

  setParent(nodeIds: string[], groupId: string | undefined): void {
    const ids = new Set(nodeIds);
    this.commit((d) => ({ ...d, nodes: d.nodes.map((node) => (ids.has(node.id) ? { ...node, parentId: groupId } : node)) }));
  }

  // ── Edges ──────────────────────────────────────────────────────────────────

  /**
   * Connect two nodes, enforcing the rules a process needs before it is ever validated: a start
   * has no way in, an end no way out, a node does not connect to itself, and the same route is not
   * drawn twice. A connection out of a decision is given the next outcome nobody routed yet, so a
   * freshly drawn approval already says «approve → …» and «reject → …».
   */
  connect(fromId: string, toId: string, actions: readonly WorkflowActionCatalogueItem[] = []): ConnectResult {
    const from = this.nodeById().get(fromId);
    const to = this.nodeById().get(toId);
    if (!from || !to) return { ok: false, reasonKey: 'workflow_engine.designer.connect.missing' };
    if (fromId === toId) return { ok: false, reasonKey: 'workflow_engine.designer.connect.self' };
    if (from.type === 'end') return { ok: false, reasonKey: 'workflow_engine.designer.connect.from_end' };
    if (to.type === 'start') return { ok: false, reasonKey: 'workflow_engine.designer.connect.to_start' };
    const existing = this.edges().filter((e) => e.from === fromId);
    if (from.type === 'start' && existing.length > 0) return { ok: false, reasonKey: 'workflow_engine.designer.connect.start_single' };

    const offered = outcomesOf(from, actions);
    const routed = new Set(existing.map((e) => e.outcome).filter(Boolean));
    const edge: WorkflowGraphEdge = { id: newId(), from: fromId, to: toId };
    if (offered.length) {
      const next = offered.find((o) => !routed.has(o));
      if (next) edge.outcome = next;
      else if (!existing.some((e) => e.default)) edge.default = true;
      else return { ok: false, reasonKey: 'workflow_engine.designer.connect.all_routed' };
    } else if (from.type === 'condition') {
      // The first branch out of a gateway is its fallback; the next ones get conditions.
      if (!existing.some((e) => e.default)) edge.default = true;
    } else if (existing.length > 0) {
      return { ok: false, reasonKey: 'workflow_engine.designer.connect.single_exit' };
    }
    if (this.edges().some((e) => e.from === fromId && e.to === toId && (e.outcome ?? '') === (edge.outcome ?? '')))
      return { ok: false, reasonKey: 'workflow_engine.designer.connect.duplicate' };

    this.commit((d) => ({ ...d, edges: [...d.edges, edge] }));
    this.select({ edges: [edge.id] });
    return { ok: true, edge };
  }

  reassign(edgeId: string, endpoint: { from?: string; to?: string }): string | null {
    const edge = this.edges().find((e) => e.id === edgeId);
    if (!edge) return null;
    const from = endpoint.from ?? edge.from;
    const to = endpoint.to ?? edge.to;
    const fromNode = this.nodeById().get(from);
    const toNode = this.nodeById().get(to);
    if (!fromNode || !toNode) return 'workflow_engine.designer.connect.missing';
    if (from === to) return 'workflow_engine.designer.connect.self';
    if (fromNode.type === 'end') return 'workflow_engine.designer.connect.from_end';
    if (toNode.type === 'start') return 'workflow_engine.designer.connect.to_start';
    this.commit((d) => ({
      ...d,
      edges: d.edges.map((e) => (e.id === edgeId ? { ...e, from, to, waypoints: undefined, ...(from !== edge.from ? { outcome: undefined } : {}) } : e)),
    }));
    return null;
  }

  patchEdge(id: string, patch: Partial<WorkflowGraphEdge>, coalesceKey?: string): void {
    this.commit(
      (d) => ({
        ...d,
        edges: d.edges.map((edge) => {
          if (edge.id === id) return clean({ ...edge, ...patch });
          // At most one default per source: choosing one clears the others.
          const target = d.edges.find((e) => e.id === id);
          if (patch.default && target && edge.from === target.from && edge.default) return { ...edge, default: false };
          return edge;
        }),
      }),
      coalesceKey ? `edge:${id}:${coalesceKey}` : undefined,
    );
  }

  setWaypoints(id: string, waypoints: WorkflowPoint[]): void {
    this.commit((d) => ({
      ...d,
      edges: d.edges.map((edge) => (edge.id === id ? { ...edge, waypoints: waypoints.length ? waypoints.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) : undefined } : edge)),
    }));
  }

  // ── Deleting, copying, pasting ──────────────────────────────────────────────

  /** Delete the given items (default: the selection). The start node is never deleted. */
  deleteItems(items: Partial<DesignerSelection> = this.selection()): number {
    const nodeIds = new Set((items.nodes ?? []).filter((id) => this.nodeById().get(id)?.type !== 'start'));
    const edgeIds = new Set(items.edges ?? []);
    const groupIds = new Set(items.groups ?? []);
    if (!nodeIds.size && !edgeIds.size && !groupIds.size) return 0;
    this.commit((d) => ({
      ...d,
      nodes: d.nodes
        .filter((n) => !nodeIds.has(n.id))
        .map((n) => (n.parentId && groupIds.has(n.parentId) ? { ...n, parentId: undefined } : n)),
      edges: d.edges.filter((e) => !edgeIds.has(e.id) && !nodeIds.has(e.from) && !nodeIds.has(e.to)),
      groups: d.groups.filter((g) => !groupIds.has(g.id)),
    }));
    this.clearSelection();
    return nodeIds.size + edgeIds.size + groupIds.size;
  }

  /** The selection as a self-contained fragment: its nodes, the connections among them, its lanes. */
  copy(items: Partial<DesignerSelection> = this.selection()): DesignerClipboard | null {
    const nodeIds = new Set((items.nodes ?? []).filter((id) => this.nodeById().get(id)?.type !== 'start'));
    const groupIds = new Set(items.groups ?? []);
    for (const node of this.nodes()) if (node.parentId && groupIds.has(node.parentId) && node.type !== 'start') nodeIds.add(node.id);
    if (!nodeIds.size && !groupIds.size) return null;
    return {
      kind: 'virtex.workflow.fragment',
      version: 1,
      nodes: this.nodes().filter((n) => nodeIds.has(n.id)),
      edges: this.edges().filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to)),
      groups: this.groups().filter((g) => groupIds.has(g.id)),
    };
  }

  /** Paste a fragment with fresh ids, internal connections remapped, offset from the original. */
  paste(fragment: DesignerClipboard, offset: number = PASTE_OFFSET): DesignerSelection {
    const ids = new Map<string, string>();
    for (const n of fragment.nodes) ids.set(n.id, newId());
    for (const g of fragment.groups) ids.set(g.id, newId('g'));
    const nodes = fragment.nodes
      .filter((n) => n.type !== 'start')
      .map((n) => ({
        ...structuredClone(n),
        id: ids.get(n.id) as string,
        position: { x: (n.position?.x ?? 0) + offset, y: (n.position?.y ?? 0) + offset },
        parentId: n.parentId ? ids.get(n.parentId) : undefined,
      }));
    const edges = fragment.edges
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e) => ({
        ...structuredClone(e),
        id: newId(),
        from: ids.get(e.from) as string,
        to: ids.get(e.to) as string,
        waypoints: e.waypoints?.map((p) => ({ x: p.x + offset, y: p.y + offset })),
      }));
    const groups = fragment.groups.map((g) => ({
      ...structuredClone(g),
      id: ids.get(g.id) as string,
      position: { x: (g.position?.x ?? 0) + offset, y: (g.position?.y ?? 0) + offset },
    }));
    this.commit((d) => ({ ...d, nodes: [...d.nodes, ...nodes], edges: [...d.edges, ...edges], groups: [...d.groups, ...groups] }));
    const selection = { nodes: nodes.map((n) => n.id), edges: edges.map((e) => e.id), groups: groups.map((g) => g.id) };
    this.select(selection);
    return selection;
  }

  duplicateSelection(): void {
    const fragment = this.copy();
    if (fragment) this.paste(fragment);
  }

  selectAll(): void {
    this.select({ nodes: this.nodes().map((n) => n.id), edges: this.edges().map((e) => e.id), groups: this.groups().map((g) => g.id) });
  }

  /** Nudge the selected nodes by a grid step (arrow keys). */
  nudge(dx: number, dy: number): void {
    const ids = new Set(this.selection().nodes);
    if (!ids.size) return;
    this.commit(
      (d) => ({
        ...d,
        nodes: d.nodes.map((n) => (ids.has(n.id) ? { ...n, position: { x: (n.position?.x ?? 0) + dx, y: (n.position?.y ?? 0) + dy } } : n)),
      }),
      'nudge',
    );
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

export function defaultConfig(type: WorkflowNodeType): NonNullable<WorkflowGraphNode['config']> {
  switch (type) {
    case 'approval':
      return { outcomes: ['approve', 'reject'], commentRequiredFor: ['reject'], dueInHours: 48 };
    case 'task':
      return { outcomes: ['done'], dueInHours: 72 };
    case 'timer':
      return { timerMinutes: 60 };
    default:
      return {};
  }
}

const LANE_PADDING = 40;
const LANE_TITLE = 28;

/** A lane resized to wrap its member steps, or unchanged when it has none. */
function fitGroup(group: WorkflowGraphGroup, members: WorkflowGraphNode[]): WorkflowGraphGroup {
  if (!members.length) return group;
  const xs = members.map((n) => n.position?.x ?? 0);
  const ys = members.map((n) => n.position?.y ?? 0);
  const x = Math.min(...xs) - LANE_PADDING;
  const y = Math.min(...ys) - LANE_PADDING - LANE_TITLE;
  return {
    ...group,
    position: { x, y },
    size: {
      width: Math.max(...xs) + NODE_WIDTH + LANE_PADDING - x,
      height: Math.max(...ys) + NODE_HEIGHT + LANE_PADDING - y,
    },
  };
}

/** Drop `undefined`, empty strings and empty arrays so a cleared field leaves no trace in the JSON. */
function clean<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === '' || (Array.isArray(item) && item.length === 0 && key !== 'outcomes')) continue;
    out[key] = item;
  }
  return out as T;
}

/** Fill the gaps an older or hand-written graph may have. */
function normalize(doc: DesignerDocument): DesignerDocument {
  return {
    ...doc,
    nodes: (doc.nodes ?? []).map((node, index) => ({
      ...node,
      position: node.position ?? { x: 80 + (index % 4) * 280, y: 80 + Math.floor(index / 4) * 160 },
    })),
    edges: doc.edges ?? [],
    groups: doc.groups ?? [],
    variables: doc.variables ?? [],
    settings: { connectionType: 'bezier', layoutDirection: 'LR', ...(doc.settings ?? {}) },
    trigger: doc.trigger ?? { mode: 'manual' },
  };
}
