import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityMetadata } from 'typeorm';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import {
  DocumentFlowMap,
  FlowDocumentType,
  FlowEdge,
  FlowNode,
  FlowStatusKind,
} from './contracts/document-flow.contracts';
import { classifyStatus, EDGE_SPECS, NODE_SPECS, NodeSpec } from './document-flow.specs';

/**
 * How many documents the map will draw before it stops expanding.
 *
 * A relationship map is read, not computed over: past a couple of hundred nodes it is a hairball
 * nobody can follow, and the traversal is breadth-first so the cap keeps the half nearest the
 * document the user asked about. `truncated` tells the client the chain continues beyond what is
 * drawn.
 */
const NODE_CAP = 250;

/** A described node plus the raw outgoing foreign keys needed to walk onwards from it. */
interface NodeEntry {
  node: FlowNode;
  /** `{ [fkProp]: referencedId | null }` for every FK this type carries. */
  links: Record<string, string | null>;
}

interface Neighbour {
  type: FlowDocumentType;
  id: string;
  from: string;
  to: string;
  relationKey: string;
}

type RawRow = Record<string, string | null>;

/**
 * Builds the document relationship map by reading the links the ERP already records.
 *
 * The engine knows nothing about any document type beyond what `document-flow.specs.ts` declares;
 * it resolves each declared entity property to its real column through TypeORM's runtime metadata
 * (so `issueDate`, `customer_id` and `invoiceNumber` are all read correctly without the spec
 * having to know which are camelCased), and walks the declared edges breadth-first from the
 * requested document, tenant-scoped at every query.
 */
@Injectable()
export class DocumentFlowService {
  private readonly logger = new Logger(DocumentFlowService.name);
  private metaByTable: Map<string, EntityMetadata> | null = null;

  constructor(private readonly dataSource: DataSource) {}

  /** The whole chain reachable from one document, as nodes and edges. */
  async buildMap(
    rootType: FlowDocumentType,
    rootId: string,
    organizationId: string,
  ): Promise<DocumentFlowMap> {
    if (!NODE_SPECS[rootType]) {
      throw new BadRequestError('relationship_map.unknown_document_type', { type: rootType });
    }

    const rootEntry = (await this.describeMany(rootType, [rootId], organizationId)).get(rootId);
    if (!rootEntry) throw new NotFoundError('relationship_map.not_found');
    rootEntry.node.root = true;

    const nodes = new Map<string, NodeEntry>([[rootEntry.node.key, rootEntry]]);
    const edges = new Map<string, FlowEdge>();
    const visited = new Set<string>();
    const queue: string[] = [rootEntry.node.key];
    let truncated = false;

    while (queue.length > 0) {
      const key = queue.shift()!;
      if (visited.has(key)) continue;
      visited.add(key);

      const entry = nodes.get(key)!;
      const neighbours = await this.neighbours(entry.node, entry.links, organizationId);

      // Describe the ones we have not seen, grouped by type so each type is one query.
      const unseen = new Map<FlowDocumentType, Set<string>>();
      for (const nb of neighbours) {
        const nbKey = `${nb.type}:${nb.id}`;
        if (!nodes.has(nbKey)) {
          (unseen.get(nb.type) ?? unseen.set(nb.type, new Set()).get(nb.type)!).add(nb.id);
        }
      }
      for (const [type, ids] of unseen) {
        if (nodes.size >= NODE_CAP) {
          truncated = true;
          break;
        }
        const described = await this.describeMany(type, [...ids], organizationId);
        for (const describedEntry of described.values()) {
          if (nodes.size >= NODE_CAP) {
            truncated = true;
            break;
          }
          nodes.set(describedEntry.node.key, describedEntry);
        }
      }

      for (const nb of neighbours) {
        // An edge is drawn only when both ends made it into the graph: a neighbour can be missing
        // because it was deleted, belongs to another tenant, or fell past the cap.
        if (!nodes.has(nb.from) || !nodes.has(nb.to) || nb.from === nb.to) continue;
        const edgeKey = `${nb.from}|${nb.to}|${nb.relationKey}`;
        if (!edges.has(edgeKey)) {
          edges.set(edgeKey, { from: nb.from, to: nb.to, relationKey: nb.relationKey });
        }
        const nbKey = `${nb.type}:${nb.id}`;
        if (nodes.has(nbKey) && !visited.has(nbKey) && !queue.includes(nbKey)) {
          queue.push(nbKey);
        }
      }
    }

    return {
      root: rootEntry.node.key,
      nodes: [...nodes.values()].map((entry) => entry.node),
      edges: [...edges.values()],
      truncated,
    };
  }

  // ── Describing nodes ─────────────────────────────────────────────────────────

  /** Read a set of documents of one type into nodes, in a single tenant-scoped query. */
  private async describeMany(
    type: FlowDocumentType,
    ids: string[],
    organizationId: string,
  ): Promise<Map<string, NodeEntry>> {
    const result = new Map<string, NodeEntry>();
    if (ids.length === 0) return result;

    const spec = NODE_SPECS[type];
    const idCol = this.columnOrThrow(spec.table, spec.idProp ?? 'id');
    const orgCol = this.columnOrThrow(spec.table, spec.orgProp ?? 'organizationId');

    const selects: string[] = [`doc."${idCol}"::text AS "id"`];
    const joins: string[] = [];

    this.pushText(selects, 'number', spec.table, spec.numberProp);
    this.pushText(selects, 'date', spec.table, spec.dateProp);
    this.pushText(selects, 'status', spec.table, spec.statusProp);
    this.pushText(selects, 'total', spec.table, spec.totalProp);
    this.pushText(selects, 'currency', spec.table, spec.currencyProp);
    this.pushText(selects, 'subtype', spec.table, spec.subtype?.prop);

    if (spec.partyNameProp) {
      this.pushText(selects, 'party', spec.table, spec.partyNameProp);
    } else if (spec.partyJoin) {
      const nameCol = this.column(spec.partyJoin.table, spec.partyJoin.nameProp);
      if (nameCol) {
        selects.push(`party."${nameCol}"::text AS "party"`);
        joins.push(
          `LEFT JOIN "${spec.partyJoin.table}" party ON party."id" = doc."${spec.partyJoin.idColumn}"`,
        );
      }
    }

    const outgoing = this.outgoingFkProps(type);
    for (const prop of outgoing) {
      const col = this.column(spec.table, prop);
      if (col) selects.push(`doc."${col}"::text AS "link_${prop}"`);
    }

    const sql =
      `SELECT ${selects.join(', ')} FROM "${spec.table}" doc ${joins.join(' ')} ` +
      `WHERE doc."${idCol}" = ANY($1::uuid[]) AND doc."${orgCol}" = $2`;

    const rows: RawRow[] = await this.dataSource.query(sql, [ids, organizationId]);
    for (const row of rows) {
      const node = this.toNode(spec, type, row);
      const links: Record<string, string | null> = {};
      for (const prop of outgoing) links[prop] = row[`link_${prop}`] ?? null;
      result.set(node.id, { node, links });
    }
    return result;
  }

  private toNode(spec: NodeSpec, type: FlowDocumentType, row: RawRow): FlowNode {
    const id = String(row['id']);
    const statusRaw = row['status'] ?? null;
    const statusKind: FlowStatusKind = statusRaw
      ? spec.statusMap?.[statusRaw] ?? classifyStatus(statusRaw)
      : 'unknown';
    const subtypeValue = row['subtype'];
    const subtypeKey =
      spec.subtype && subtypeValue ? spec.subtype.map[subtypeValue] ?? null : null;
    const total = row['total'];

    return {
      key: `${type}:${id}`,
      type,
      id,
      typeKey: spec.typeKey,
      icon: spec.icon,
      number: row['number'] ?? null,
      subtypeKey,
      date: row['date'] ? String(row['date']).slice(0, 10) : null,
      statusKind,
      statusRaw,
      amount: total != null && total !== '' ? Number(total) : null,
      currencyCode: row['currency'] ?? null,
      party: row['party'] ?? null,
      route: spec.route ? spec.route(id) : null,
      root: false,
    };
  }

  // ── Walking edges ────────────────────────────────────────────────────────────

  private async neighbours(
    node: FlowNode,
    links: Record<string, string | null>,
    organizationId: string,
  ): Promise<Neighbour[]> {
    const out: Neighbour[] = [];

    for (const edge of EDGE_SPECS) {
      if (edge.kind === 'fk') {
        // This node carries the FK → follow it to the referenced document.
        if (edge.fkType === node.type) {
          const refId = links[edge.fkProp];
          if (refId) {
            const refKey = `${edge.refType}:${refId}`;
            const { from, to } = this.fkDirection(edge.fkRole, node.key, refKey);
            out.push({ type: edge.refType, id: refId, from, to, relationKey: edge.relationKey });
          }
        }
        // Other documents carry an FK pointing at this node → find them.
        if (edge.refType === node.type) {
          const fkCol = this.column(edge.fkTable, edge.fkProp);
          const orgCol = this.column(edge.fkTable, 'organizationId');
          if (fkCol && orgCol) {
            const idCol = this.columnOrThrow(edge.fkTable, 'id');
            const rows: RawRow[] = await this.dataSource.query(
              `SELECT "${idCol}"::text AS id FROM "${edge.fkTable}" WHERE "${fkCol}" = $1 AND "${orgCol}" = $2`,
              [node.id, organizationId],
            );
            for (const row of rows) {
              const otherKey = `${edge.fkType}:${row['id']}`;
              const { from, to } = this.fkDirection(edge.fkRole, otherKey, node.key);
              out.push({
                type: edge.fkType,
                id: String(row['id']),
                from,
                to,
                relationKey: edge.relationKey,
              });
            }
          }
        }
      } else {
        // Junction (link) table carrying both ids — e.g. an invoice applied on a receipt.
        if (edge.aType === node.type) {
          out.push(...(await this.junctionSide(edge, node, edge.aProp, edge.bProp, edge.bType)));
        }
        if (edge.bType === node.type) {
          out.push(...(await this.junctionSide(edge, node, edge.bProp, edge.aProp, edge.aType)));
        }
      }
    }
    return out;
  }

  private async junctionSide(
    edge: Extract<(typeof EDGE_SPECS)[number], { kind: 'junction' }>,
    node: FlowNode,
    thisProp: string,
    otherProp: string,
    otherType: FlowDocumentType,
  ): Promise<Neighbour[]> {
    const thisCol = this.column(edge.table, thisProp);
    const otherCol = this.column(edge.table, otherProp);
    if (!thisCol || !otherCol) return [];

    // No tenant filter here: the row we start from is already tenant-checked, and every neighbour
    // is re-read through `describeMany`, which filters by organisation — a foreign id simply yields
    // no node and no edge.
    const rows: RawRow[] = await this.dataSource.query(
      `SELECT "${otherCol}"::text AS id FROM "${edge.table}" WHERE "${thisCol}" = $1 AND "${otherCol}" IS NOT NULL`,
      [node.id],
    );

    return rows.map((row) => {
      const otherKey = `${otherType}:${row['id']}`;
      const aKey = node.type === edge.aType ? node.key : otherKey;
      const bKey = node.type === edge.aType ? otherKey : node.key;
      const [from, to] = edge.sourceSide === 'a' ? [aKey, bKey] : [bKey, aKey];
      return { type: otherType, id: String(row['id']), from, to, relationKey: edge.relationKey };
    });
  }

  /** Orient an FK edge: the FK carrier is the source when `fkRole` says so, else the target. */
  private fkDirection(
    fkRole: 'source' | 'target',
    carrierKey: string,
    refKey: string,
  ): { from: string; to: string } {
    return fkRole === 'source' ? { from: carrierKey, to: refKey } : { from: refKey, to: carrierKey };
  }

  private outgoingFkProps(type: FlowDocumentType): string[] {
    const props = new Set<string>();
    for (const edge of EDGE_SPECS) {
      if (edge.kind === 'fk' && edge.fkType === type) props.add(edge.fkProp);
    }
    return [...props];
  }

  // ── Metadata-driven column resolution ─────────────────────────────────────────

  private meta(): Map<string, EntityMetadata> {
    if (!this.metaByTable) {
      this.metaByTable = new Map();
      for (const metadata of this.dataSource.entityMetadatas) {
        this.metaByTable.set(metadata.tableName, metadata);
      }
    }
    return this.metaByTable;
  }

  /** Real column name for an entity property, or null when the property does not exist. */
  private column(table: string, prop: string): string | null {
    const metadata = this.meta().get(table);
    if (!metadata) return null;
    const column = metadata.columns.find((candidate) => candidate.propertyName === prop);
    return column ? column.databaseName : null;
  }

  private columnOrThrow(table: string, prop: string): string {
    const column = this.column(table, prop);
    if (!column) {
      this.logger.error(`relationship-map: no column for ${table}.${prop}`);
      throw new BadRequestError('relationship_map.unknown_document_type', { type: table });
    }
    return column;
  }

  /** Append `doc."<col>"::text AS "<alias>"` when the property resolves; skip it silently if not. */
  private pushText(selects: string[], alias: string, table: string, prop?: string): void {
    if (!prop) return;
    const col = this.column(table, prop);
    if (col) selects.push(`doc."${col}"::text AS "${alias}"`);
  }
}
