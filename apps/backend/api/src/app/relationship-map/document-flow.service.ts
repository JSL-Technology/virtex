import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { hasPermission } from '@virteex/shared/util-auth';
import {
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from '../i18n/localized.exception';
import { BranchScope, loadBranchScope } from '../organizations/contracts/branch.contract';
import {
  DocumentFlowMap,
  FlowDocumentSearchHit,
  FlowDocumentType,
  FlowDocumentTypeInfo,
  FlowEdge,
  FlowNode,
  FlowRelationCategory,
  FlowTruncation,
  FLOW_DOCUMENT_TYPES,
} from './contracts/document-flow.contracts';
import { CompiledEdge, CompiledNode, DocumentFlowCatalog } from './document-flow.catalog';
import { relationKey, statusKindOf } from './document-flow.specs';

/** Who is asking. The map is filtered by their tenant, their permissions and their branches. */
export interface FlowPrincipal {
  organizationId: string;
  userId: string | null;
  permissions: string[];
}

export interface FlowMapOptions {
  maxDepth?: number;
  maxNodes?: number;
}

/**
 * Limits. A relationship map is read, not computed over: past a couple of hundred nodes it is a
 * hairball nobody can follow, so the traversal is breadth-first — the cap keeps the part nearest
 * the document asked about — and the response says which limit was hit.
 */
export const FLOW_LIMITS = {
  defaultDepth: 8,
  maxDepth: 20,
  defaultNodes: 150,
  maxNodes: 400,
  /** Links of one kind drawn from one document (an asset's monthly depreciations). */
  fanOut: 60,
  /** Per-statement ceiling, so a pathological chain cannot hold a connection. */
  statementTimeoutMs: 8000,
  searchPerType: 8,
  searchTotal: 25,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, string | null>;
type Query = (sql: string, params: unknown[]) => Promise<Row[]>;

/** A described document plus what the engine needs to walk on from it. */
interface Entry {
  node: FlowNode;
  /** Outgoing FK property → referenced id. */
  links: Map<string, string>;
  branchId: string | null;
}

/** A link discovered while expanding: the neighbour to visit and the edge to draw. */
interface Discovered {
  type: FlowDocumentType;
  id: string;
  edge: Omit<FlowEdge, 'key' | 'relationKey'>;
}

/**
 * Builds the document relationship map by reading the links the ERP already records.
 *
 * ## How it scales
 *
 * The walk is breadth-first and *batched by level*: each step takes the whole frontier, and for
 * every link spec runs ONE query over all frontier documents of the matching type
 * (`… = ANY($1::uuid[])`), then describes every newly found document of a type in ONE query. The
 * number of statements grows with the depth of the chain and the number of link kinds — not with
 * the number of documents — where the first version ran several statements per document.
 *
 * ## How it stays consistent and bounded
 *
 * Everything runs in one READ ONLY, REPEATABLE READ transaction on the request's tenant-bound
 * connection: the map is a single snapshot (a receipt posted mid-walk cannot appear half-linked),
 * cannot write, and each statement carries a timeout.
 *
 * ## How it stays safe
 *
 * Every statement is filtered by the caller's tenant — on top of the database's row-level policies
 * — and every identifier in it comes from the compiled catalog, never from the request. A document
 * whose module the caller cannot read, or that belongs to a branch outside their scope, is drawn as
 * a restricted node with every identifying field withheld.
 */
@Injectable()
export class DocumentFlowService {
  private readonly logger = new Logger(DocumentFlowService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly catalog: DocumentFlowCatalog,
  ) {}

  // ── Public API ───────────────────────────────────────────────────────────────

  /** The whole chain reachable from one document, as nodes and edges. */
  async buildMap(
    rootType: FlowDocumentType,
    rootId: string,
    principal: FlowPrincipal,
    options: FlowMapOptions = {},
  ): Promise<DocumentFlowMap> {
    const maxDepth = clamp(options.maxDepth ?? FLOW_LIMITS.defaultDepth, 1, FLOW_LIMITS.maxDepth);
    const maxNodes = clamp(options.maxNodes ?? FLOW_LIMITS.defaultNodes, 2, FLOW_LIMITS.maxNodes);
    const rootSpec = this.catalog.node(rootType);
    if (!rootSpec || !UUID.test(rootId)) throw new NotFoundError('relationship_map.not_found');
    // Refused before any work: a map is opened from a document, and someone who may not read that
    // document may not read the chain hanging off it either.
    if (!hasPermission(principal.permissions, [rootSpec.spec.permission])) {
      throw new ForbiddenError('relationship_map.forbidden');
    }

    const started = Date.now();
    let statements = 0;

    return this.readOnly(async (manager) => {
      const query: Query = (sql, params) => {
        statements += 1;
        return manager.query(sql, params);
      };
      const org = principal.organizationId;

      const rootEntry = (await this.describe(query, rootSpec, [rootId], org, 0))[0];
      if (!rootEntry) throw new NotFoundError('relationship_map.not_found');
      rootEntry.node.root = true;

      const entries = new Map<string, Entry>([[rootEntry.node.key, rootEntry]]);
      const edges = new Map<string, FlowEdge>();
      const truncation: FlowTruncation = { nodes: false, depth: false, fanOut: false };
      let frontier: Entry[] = [rootEntry];
      let depth = 0;

      while (frontier.length > 0) {
        const found = await this.discover(query, frontier, org, truncation);

        // Unseen neighbours, in discovery order, deduplicated.
        const unseen = new Map<string, Discovered>();
        for (const item of found) {
          const key = nodeKey(item.type, item.id);
          if (!entries.has(key) && !unseen.has(key)) unseen.set(key, item);
        }

        const next: Entry[] = [];
        if (unseen.size > 0) {
          if (depth >= maxDepth) {
            truncation.depth = true;
          } else {
            const room = maxNodes - entries.size;
            if (unseen.size > room) truncation.nodes = true;
            const admitted = [...unseen.values()].slice(0, Math.max(room, 0));
            for (const [type, ids] of groupByType(admitted)) {
              const spec = this.catalog.node(type);
              if (!spec) continue;
              for (const entry of await this.describe(query, spec, ids, org, depth + 1)) {
                entries.set(entry.node.key, entry);
                next.push(entry);
              }
            }
          }
        }

        // An edge is drawn only when both ends made it in: a neighbour can be missing because it
        // was deleted, belongs to another tenant, or fell past a limit.
        for (const item of found) {
          const { from, to, relation, category } = item.edge;
          if (from === to || !entries.has(from) || !entries.has(to)) continue;
          const key = `${from}|${to}|${relation}`;
          if (!edges.has(key)) {
            edges.set(key, { key, from, to, relation, relationKey: relationKey(relation), category });
          }
        }

        frontier = next;
        depth += 1;
      }

      const scope = await loadBranchScope(manager, org, principal.userId);
      for (const entry of entries.values()) this.redact(entry, principal, scope);
      if (rootEntry.node.restricted) {
        throw new ForbiddenError('relationship_map.forbidden');
      }

      const nodes = [...entries.values()].map((entry) => entry.node).sort(byDepthThenDate);
      const elapsed = Date.now() - started;
      const log = `map ${rootType} nodes=${nodes.length} edges=${edges.size} statements=${statements} ${elapsed}ms`;
      if (elapsed > 1500) this.logger.warn(`slow ${log}`);
      else this.logger.debug(log);

      return {
        root: rootEntry.node.key,
        nodes,
        edges: [...edges.values()],
        truncated: truncation.nodes || truncation.depth || truncation.fanOut,
        truncation,
        limits: { maxNodes, maxDepth },
        depthReached: nodes.reduce((max, node) => Math.max(max, node.depth), 0),
        generatedAt: new Date().toISOString(),
      };
    });
  }

  /** The document types the caller can open a map from (their permissions decide). */
  documentTypes(principal: FlowPrincipal): FlowDocumentTypeInfo[] {
    return FLOW_DOCUMENT_TYPES.flatMap((type) => {
      const compiled = this.catalog.node(type);
      if (!compiled || !hasPermission(principal.permissions, [compiled.spec.permission])) return [];
      return [
        {
          type,
          module: compiled.spec.module,
          typeKey: compiled.spec.typeKey,
          searchable: Boolean(compiled.spec.searchable && compiled.selects['number']),
        },
      ];
    });
  }

  /**
   * Find documents by number (prefix or contained, case-insensitive) — or by id, when the text is
   * one — across every searchable type the caller may read, to open a map from.
   */
  async search(
    text: string,
    principal: FlowPrincipal,
    type?: FlowDocumentType,
  ): Promise<FlowDocumentSearchHit[]> {
    const term = text.trim();
    if (!term) return [];
    const byId = UUID.test(term);
    const targets = this.documentTypes(principal)
      .filter((info) => (type ? info.type === type : true))
      .filter((info) => byId || info.searchable)
      .map((info) => this.catalog.node(info.type)!)
      .filter(Boolean);
    if (targets.length === 0) return [];

    return this.readOnly(async (manager) => {
      const scope = await loadBranchScope(manager, principal.organizationId, principal.userId);
      const hits: Array<FlowDocumentSearchHit & { rank: number }> = [];
      const pattern = `%${escapeLike(term)}%`;
      const prefix = `${escapeLike(term)}%`;

      for (const spec of targets) {
        let rows: Row[];
        if (byId) {
          rows = await manager.query(...this.describeSql(spec, [term], principal.organizationId));
        } else {
          const number = spec.selects['number'];
          const [sql, params] = this.selectSql(
            spec,
            `${number} ILIKE $1 ESCAPE '\\'`,
            [pattern, principal.organizationId],
            `ORDER BY (${number} ILIKE $3 ESCAPE '\\') DESC, ${spec.selects['date'] ?? 'NULL'} DESC NULLS LAST LIMIT ${FLOW_LIMITS.searchPerType}`,
          );
          rows = await manager.query(sql, [...params, prefix]);
        }
        for (const row of rows) {
          if (spec.branch && scope.allowed && !(row['branch'] && scope.allowed.includes(row['branch']))) continue;
          const entry = this.toEntry(spec, row, 0);
          const node = entry.node;
          const number = node.number ?? '';
          const rank = number.toLowerCase() === term.toLowerCase() ? 0 : number.toLowerCase().startsWith(term.toLowerCase()) ? 1 : 2;
          hits.push({
            rank,
            key: node.key,
            type: node.type,
            id: node.id,
            module: node.module,
            typeKey: node.typeKey,
            number: node.number,
            description: node.description,
            date: node.date,
            party: node.party,
            amount: node.amount,
            currencyCode: node.currencyCode,
            statusKind: node.statusKind,
          });
        }
      }

      return hits
        .sort((a, b) => a.rank - b.rank || (b.date ?? '').localeCompare(a.date ?? ''))
        .slice(0, FLOW_LIMITS.searchTotal)
        .map(({ rank: _rank, ...hit }) => hit);
    });
  }

  // ── Expansion ────────────────────────────────────────────────────────────────

  /** Every link out of the frontier, across all link specs, one statement per spec and side. */
  private async discover(
    query: Query,
    frontier: Entry[],
    org: string,
    truncation: FlowTruncation,
  ): Promise<Discovered[]> {
    const out: Discovered[] = [];
    const byType = new Map<FlowDocumentType, Entry[]>();
    for (const entry of frontier) {
      const bucket = byType.get(entry.node.type);
      if (bucket) bucket.push(entry);
      else byType.set(entry.node.type, [entry]);
    }

    for (const edge of this.catalog.edges()) {
      if (edge.kind === 'fk') {
        const { carrier, target, prop, carrierRole, relation, category } = edge.spec;

        // Frontier documents that CARRY the FK: the neighbour id is already in hand.
        for (const entry of this.expandable(byType.get(carrier), target)) {
          const refId = entry.links.get(prop);
          if (!refId) continue;
          const refKey = nodeKey(target, refId);
          out.push({
            type: target,
            id: refId,
            edge: orient(carrierRole === 'source', entry.node.key, refKey, relation, category),
          });
        }

        // Frontier documents that are POINTED AT: find the carriers, in one statement.
        const pointedAt = this.expandable(byType.get(target), carrier);
        if (pointedAt.length > 0) {
          for (const row of await this.incoming(query, edge, pointedAt, org, truncation)) {
            out.push({
              type: carrier,
              id: row.id,
              edge: orient(
                carrierRole === 'source',
                nodeKey(carrier, row.id),
                nodeKey(target, row.ref),
                relation,
                category,
              ),
            });
          }
        }
      } else {
        const { aType, bType, sourceSide, relation, category } = edge.spec;
        for (const side of ['a', 'b'] as const) {
          const thisType = side === 'a' ? aType : bType;
          const otherType = side === 'a' ? bType : aType;
          const from = this.expandable(byType.get(thisType), otherType);
          if (from.length === 0) continue;
          for (const row of await this.junction(query, edge, side, from, org, truncation)) {
            const thisKey = nodeKey(thisType, row.ref);
            const otherKey = nodeKey(otherType, row.id);
            const aKey = side === 'a' ? thisKey : otherKey;
            const bKey = side === 'a' ? otherKey : thisKey;
            out.push({ type: otherType, id: row.id, edge: orient(sourceSide === 'a', aKey, bKey, relation, category) });
          }
        }
      }
    }
    return out;
  }

  /**
   * The frontier entries that may expand towards `otherType`. A hub (a journal entry) that the walk
   * merely passed through expands only into other hubs — its reversal — not back out into every
   * document that shares it; opened on its own, it expands normally.
   */
  private expandable(entries: Entry[] | undefined, otherType: FlowDocumentType): Entry[] {
    if (!entries) return [];
    return entries.filter((entry) => {
      if (entry.node.root) return true;
      if (!this.catalog.node(entry.node.type)?.spec.hub) return true;
      return Boolean(this.catalog.node(otherType)?.spec.hub);
    });
  }

  /** Carriers pointing at any of `targets`, at most `fanOut` per target. */
  private async incoming(
    query: Query,
    edge: Extract<CompiledEdge, { kind: 'fk' }>,
    targets: Entry[],
    org: string,
    truncation: FlowTruncation,
  ): Promise<Array<{ id: string; ref: string }>> {
    const ids = idsFor(targets, edge.fk.cast);
    if (ids.length === 0) return [];
    const tenant = orgFilter('c', edge.carrierOrgs);
    const sql =
      `SELECT x.id, x.ref FROM (` +
      `SELECT c."${edge.carrierId}"::text AS id, c."${edge.fk.sql}"::text AS ref, ` +
      `row_number() OVER (PARTITION BY c."${edge.fk.sql}" ORDER BY c."${edge.carrierId}") AS rn ` +
      `FROM "${edge.carrierTable}" c WHERE c."${edge.fk.sql}" = ANY($1::${edge.fk.cast}[]) AND ${tenant}` +
      `) x WHERE x.rn <= $3`;
    return this.capFanOut(await query(sql, [ids, org, FLOW_LIMITS.fanOut + 1]), truncation);
  }

  /** The other side of a junction for each of `from`, at most `fanOut` per document. */
  private async junction(
    query: Query,
    edge: Extract<CompiledEdge, { kind: 'junction' }>,
    side: 'a' | 'b',
    from: Entry[],
    org: string,
    truncation: FlowTruncation,
  ): Promise<Array<{ id: string; ref: string }>> {
    const thisCol = side === 'a' ? edge.a : edge.b;
    const otherCol = side === 'a' ? edge.b : edge.a;
    const ids = idsFor(from, thisCol.cast);
    if (ids.length === 0) return [];

    let tenantJoin = '';
    let tenantWhere: string;
    if (edge.org) {
      tenantWhere = `j."${edge.org}" = $2`;
    } else {
      // No tenant column on the junction: filter through the parent document's table.
      const parentType = edge.spec.tenantSide === 'a' ? edge.spec.aType : edge.spec.bType;
      const parent = this.catalog.node(parentType)!;
      const parentCol = edge.spec.tenantSide === 'a' ? edge.a : edge.b;
      tenantJoin = `JOIN "${parent.table}" t ON t."${parent.id.sql}" = j."${parentCol.sql}" `;
      tenantWhere = orgFilter('t', parent.orgs);
    }

    const sql =
      `SELECT x.id, x.ref FROM (` +
      `SELECT DISTINCT ON (j."${thisCol.sql}", j."${otherCol.sql}") j."${otherCol.sql}"::text AS id, j."${thisCol.sql}"::text AS ref, ` +
      `dense_rank() OVER (PARTITION BY j."${thisCol.sql}" ORDER BY j."${otherCol.sql}") AS rn ` +
      `FROM "${edge.table}" j ${tenantJoin}` +
      `WHERE j."${thisCol.sql}" = ANY($1::${thisCol.cast}[]) AND j."${otherCol.sql}" IS NOT NULL AND ${tenantWhere}` +
      `) x WHERE x.rn <= $3`;
    return this.capFanOut(await query(sql, [ids, org, FLOW_LIMITS.fanOut + 1]), truncation);
  }

  /** Keep at most `fanOut` rows per `ref`; flag the map when one document had more. */
  private capFanOut(rows: Row[], truncation: FlowTruncation): Array<{ id: string; ref: string }> {
    const counts = new Map<string, number>();
    const out: Array<{ id: string; ref: string }> = [];
    for (const row of rows) {
      const id = row['id'];
      const ref = row['ref'];
      if (!id || !ref) continue;
      const seen = (counts.get(ref) ?? 0) + 1;
      counts.set(ref, seen);
      if (seen > FLOW_LIMITS.fanOut) {
        truncation.fanOut = true;
        continue;
      }
      out.push({ id, ref });
    }
    return out;
  }

  // ── Describing documents ─────────────────────────────────────────────────────

  private async describe(
    query: Query,
    spec: CompiledNode,
    ids: string[],
    org: string,
    depth: number,
  ): Promise<Entry[]> {
    const valid = spec.id.cast === 'uuid' ? ids.filter((id) => UUID.test(id)) : ids;
    if (valid.length === 0) return [];
    const [sql, params] = this.describeSql(spec, valid, org);
    const rows = await query(sql, params);
    return rows.map((row) => this.toEntry(spec, row, depth));
  }

  private describeSql(spec: CompiledNode, ids: string[], org: string): [string, unknown[]] {
    return this.selectSql(spec, `doc."${spec.id.sql}" = ANY($1::${spec.id.cast}[])`, [ids, org]);
  }

  /** `SELECT` a document type's node columns plus its outgoing links. `$2` is always the tenant. */
  private selectSql(spec: CompiledNode, where: string, params: unknown[], tail = ''): [string, unknown[]] {
    const columns = [`doc."${spec.id.sql}"::text AS "id"`];
    for (const [alias, expr] of Object.entries(spec.selects)) columns.push(`${expr} AS "${alias}"`);
    [...spec.links.values()].forEach((column, index) => columns.push(`doc."${column}"::text AS "link_${index}"`));
    const sql =
      `SELECT ${columns.join(', ')} FROM "${spec.table}" doc ${spec.joins.join(' ')} ` +
      `WHERE ${where} AND ${orgFilter('doc', spec.orgs)} ${tail}`;
    return [sql, params];
  }

  private toEntry(compiled: CompiledNode, row: Row, depth: number): Entry {
    const { spec } = compiled;
    const id = String(row['id']);
    const statusRaw = row['status'] ?? null;
    const total = row['total'];
    const subtype = row['subtype'];
    const links = new Map<string, string>();
    [...compiled.links.keys()].forEach((prop, index) => {
      const value = row[`link_${index}`];
      if (value) links.set(prop, value);
    });

    return {
      links,
      branchId: row['branch'] ?? null,
      node: {
        key: nodeKey(spec.type, id),
        type: spec.type,
        id,
        module: spec.module,
        typeKey: spec.typeKey,
        number: row['number'] ?? null,
        subtypeKey: spec.subtype && subtype ? spec.subtype.map[subtype] ?? null : null,
        description: row['description'] ?? null,
        date: row['date'] ? String(row['date']).slice(0, 10) : null,
        statusKind: statusKindOf(spec, statusRaw),
        statusRaw,
        amount: total != null && total !== '' && Number.isFinite(Number(total)) ? Number(total) : null,
        currencyCode: row['currency'] ?? null,
        party: row['party'] ?? null,
        root: false,
        depth,
        restricted: false,
      },
    };
  }

  /** Withhold everything identifying from a document the caller may not read. */
  private redact(entry: Entry, principal: FlowPrincipal, scope: BranchScope): void {
    const spec = this.catalog.node(entry.node.type)?.spec;
    const permitted = !!spec && hasPermission(principal.permissions, [spec.permission]);
    const inScope =
      !scope.allowed || !this.catalog.node(entry.node.type)?.branch
        ? true
        : !!entry.branchId && scope.allowed.includes(entry.branchId);
    if (permitted && inScope) return;
    Object.assign(entry.node, {
      restricted: true,
      number: null,
      subtypeKey: null,
      description: null,
      date: null,
      statusKind: 'unknown',
      statusRaw: null,
      amount: null,
      currencyCode: null,
      party: null,
    } satisfies Partial<FlowNode>);
  }

  // ── Transaction ──────────────────────────────────────────────────────────────

  /**
   * One read-only snapshot with a statement timeout. Inside a request the patched
   * `DataSource.transaction` opens it on the tenant-bound connection (see tenant-repository.patch).
   */
  private async readOnly<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.dataSource.transaction('REPEATABLE READ', async (manager) => {
        await manager.query('SET TRANSACTION READ ONLY');
        await manager.query(`SELECT set_config('statement_timeout', $1, true)`, [
          String(FLOW_LIMITS.statementTimeoutMs),
        ]);
        return work(manager);
      });
    } catch (error) {
      // 57014 = query_canceled: the statement timeout fired.
      if ((error as { code?: string }).code === '57014' || (error as { driverError?: { code?: string } }).driverError?.code === '57014') {
        this.logger.warn('relationship map timed out');
        throw new UnprocessableEntityError('relationship_map.too_large');
      }
      throw error;
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function nodeKey(type: FlowDocumentType, id: string): string {
  return `${type}:${id}`;
}

function orient(
  carrierIsSource: boolean,
  carrierKey: string,
  otherKey: string,
  relation: string,
  category: FlowRelationCategory,
): Discovered['edge'] {
  return carrierIsSource
    ? { from: carrierKey, to: otherKey, relation, category }
    : { from: otherKey, to: carrierKey, relation, category };
}

function orgFilter(alias: string, columns: string[]): string {
  return `(${columns.map((column) => `${alias}."${column}" = $2`).join(' OR ')})`;
}

function idsFor(entries: Entry[], cast: 'uuid' | 'text'): string[] {
  const ids = entries.map((entry) => entry.node.id);
  return cast === 'uuid' ? ids.filter((id) => UUID.test(id)) : ids;
}

function groupByType(items: Discovered[]): Map<FlowDocumentType, string[]> {
  const groups = new Map<FlowDocumentType, string[]>();
  for (const item of items) {
    const bucket = groups.get(item.type);
    if (bucket) bucket.push(item.id);
    else groups.set(item.type, [item.id]);
  }
  return groups;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), min), max) : min;
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function byDepthThenDate(a: FlowNode, b: FlowNode): number {
  return a.depth - b.depth || (a.date ?? '').localeCompare(b.date ?? '') || a.key.localeCompare(b.key);
}
