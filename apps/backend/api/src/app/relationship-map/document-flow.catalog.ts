import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource, EntityMetadata } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { FlowDocumentType } from './contracts/document-flow.contracts';
import { EDGE_SPECS, EdgeSpec, NODE_SPECS, NodeSpec } from './document-flow.specs';

/**
 * A column as the SQL needs it: its quoted name, and the array cast that matches its type so an
 * `= ANY($1::<cast>[])` keeps using the column's index.
 */
export interface ResolvedColumn {
  sql: string;
  cast: 'uuid' | 'text';
}

/** A node spec resolved against the live schema. Every name in it is safe to interpolate. */
export interface CompiledNode {
  spec: NodeSpec;
  table: string;
  id: ResolvedColumn;
  /** One or more tenant columns; a row belongs to the caller if any of them matches. */
  orgs: string[];
  /** The branch column, when the document is issued at a branch. */
  branch: string | null;
  /** `SELECT` expressions keyed by alias (`number`, `date`, …), referencing `doc` and joins. */
  selects: Record<string, string>;
  /** `LEFT JOIN` clauses. They reference the tenant parameter `$2`. */
  joins: string[];
  /** Outgoing FK props → their column on this table. */
  links: Map<string, string>;
}

/** An FK edge resolved against the live schema. */
export interface CompiledFkEdge {
  kind: 'fk';
  spec: Extract<EdgeSpec, { kind: 'fk' }>;
  /** Carrier table and its FK column, for the incoming direction. */
  carrierTable: string;
  carrierId: string;
  fk: ResolvedColumn;
  carrierOrgs: string[];
}

/** A junction edge resolved against the live schema. */
export interface CompiledJunctionEdge {
  kind: 'junction';
  spec: Extract<EdgeSpec, { kind: 'junction' }>;
  table: string;
  a: ResolvedColumn;
  b: ResolvedColumn;
  /** The junction's own tenant column, or null when it is filtered through `tenantSide`'s table. */
  org: string | null;
}

export type CompiledEdge = CompiledFkEdge | CompiledJunctionEdge;

/** One spec that could not be resolved, for the start-up report and the integrity test. */
export interface CatalogProblem {
  where: string;
  problem: string;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Resolves the declarative registry (`document-flow.specs.ts`) against TypeORM's runtime metadata,
 * once, and serves the compiled form to the engine.
 *
 * ## Why compile instead of resolving per request
 *
 * The first version looked up each property's column on every query. Doing it once means the
 * request path builds SQL from strings already proven to exist and to be plain identifiers, and a
 * schema change that breaks a spec — a renamed column, a dropped entity — is logged loudly at
 * start-up and degrades to "that link is not drawn" instead of failing a user's map.
 *
 * Every identifier that reaches SQL comes from TypeORM's own metadata AND matches {@link IDENTIFIER}
 * before it is quoted: nothing from the request is ever interpolated.
 */
@Injectable()
export class DocumentFlowCatalog implements OnApplicationBootstrap {
  private readonly logger = new Logger(DocumentFlowCatalog.name);
  private compiled: {
    nodes: Map<FlowDocumentType, CompiledNode>;
    edges: CompiledEdge[];
    problems: CatalogProblem[];
  } | null = null;

  constructor(private readonly dataSource: DataSource) {}

  onApplicationBootstrap(): void {
    const { problems, nodes, edges } = this.state();
    if (problems.length) {
      for (const p of problems) this.logger.error(`relationship-map spec ${p.where}: ${p.problem}`);
    }
    this.logger.log(`relationship-map: ${nodes.size} document types, ${edges.length} links compiled`);
  }

  node(type: FlowDocumentType): CompiledNode | undefined {
    return this.state().nodes.get(type);
  }

  nodes(): CompiledNode[] {
    return [...this.state().nodes.values()];
  }

  edges(): CompiledEdge[] {
    return this.state().edges;
  }

  problems(): CatalogProblem[] {
    return this.state().problems;
  }

  // ── Compilation ──────────────────────────────────────────────────────────────

  private state() {
    if (!this.compiled) this.compiled = this.compile();
    return this.compiled;
  }

  private compile() {
    const problems: CatalogProblem[] = [];
    const nodes = new Map<FlowDocumentType, CompiledNode>();

    for (const spec of Object.values(NODE_SPECS)) {
      try {
        nodes.set(spec.type, this.compileNode(spec, problems));
      } catch (error) {
        problems.push({ where: spec.type, problem: (error as Error).message });
      }
    }

    const edges: CompiledEdge[] = [];
    for (const spec of EDGE_SPECS) {
      const where = describeEdge(spec);
      try {
        const edge = this.compileEdge(spec, nodes);
        if (edge) edges.push(edge);
        else problems.push({ where, problem: 'an endpoint type did not compile' });
      } catch (error) {
        problems.push({ where, problem: (error as Error).message });
      }
    }
    return { nodes, edges, problems };
  }

  private compileNode(spec: NodeSpec, problems: CatalogProblem[]): CompiledNode {
    const meta = this.metadata(spec.entity);
    const table = ident(meta.tableName);
    const idColumn = this.column(meta, 'id');
    const orgs = (spec.orgProps ?? ['organizationId']).map((prop) => this.columnName(meta, prop));
    const branchMeta = this.findColumn(meta, 'branchId');
    const selects: Record<string, string> = {};
    const joins: string[] = [];

    // Optional fields: a property that does not resolve is reported and skipped, not fatal.
    const optional = (alias: string, prop: string | undefined) => {
      if (!prop) return;
      const col = this.findColumn(meta, prop);
      if (col) selects[alias] = `doc."${ident(col.databaseName)}"::text`;
      else problems.push({ where: `${spec.type}.${alias}`, problem: `no property "${prop}" on ${spec.entity}` });
    };
    optional('number', spec.numberProp);
    optional('date', spec.dateProp);
    optional('status', spec.statusProp);
    optional('total', spec.totalProp);
    optional('currency', spec.currencyProp);
    optional('party', spec.partyNameProp);
    optional('description', spec.descriptionProp);
    optional('subtype', spec.subtype?.prop);
    if (branchMeta) selects['branch'] = `doc."${ident(branchMeta.databaseName)}"::text`;

    const lookup = (alias: 'party' | 'currency', join: NodeSpec['partyLookup']) => {
      if (!join) return;
      try {
        const via = this.columnName(meta, join.via);
        const target = this.metadata(join.entity);
        const prop = this.columnName(target, join.prop);
        const targetOrg = this.findColumn(target, 'organizationId');
        const as = `j_${alias}`;
        // The joined master row is tenant-filtered too: a dangling FK into another tenant's row
        // must not lend this document that tenant's customer name.
        const tenant = targetOrg ? ` AND ${as}."${ident(targetOrg.databaseName)}" = $2` : '';
        joins.push(
          `LEFT JOIN "${ident(target.tableName)}" ${as} ON ${as}."${this.columnName(target, 'id')}" = doc."${via}"${tenant}`,
        );
        selects[alias] = `${as}."${prop}"::text`;
      } catch (error) {
        problems.push({ where: `${spec.type}.${alias}`, problem: (error as Error).message });
      }
    };
    lookup('party', spec.partyLookup);
    lookup('currency', spec.currencyLookup);

    if (spec.totalAggregate) {
      try {
        const child = this.metadata(spec.totalAggregate.entity);
        const fk = this.columnName(child, spec.totalAggregate.fkProp);
        const sum = this.columnName(child, spec.totalAggregate.sumProp);
        selects['total'] =
          `(SELECT SUM(agg."${sum}") FROM "${ident(child.tableName)}" agg WHERE agg."${fk}" = doc."${idColumn.sql}")::text`;
      } catch (error) {
        problems.push({ where: `${spec.type}.total`, problem: (error as Error).message });
      }
    }

    const links = new Map<string, string>();
    for (const edge of EDGE_SPECS) {
      if (edge.kind === 'fk' && edge.carrier === spec.type && !links.has(edge.prop)) {
        const col = this.findColumn(meta, edge.prop);
        if (col) links.set(edge.prop, ident(col.databaseName));
      }
    }

    return {
      spec,
      table,
      id: idColumn,
      orgs,
      branch: branchMeta ? ident(branchMeta.databaseName) : null,
      selects,
      joins,
      links,
    };
  }

  private compileEdge(spec: EdgeSpec, nodes: Map<FlowDocumentType, CompiledNode>): CompiledEdge | null {
    if (spec.kind === 'fk') {
      const carrier = nodes.get(spec.carrier);
      if (!carrier || !nodes.get(spec.target)) return null;
      if (!carrier.links.has(spec.prop)) {
        throw new Error(`no property "${spec.prop}" on ${carrier.spec.entity}`);
      }
      const meta = this.metadata(carrier.spec.entity);
      return {
        kind: 'fk',
        spec,
        carrierTable: carrier.table,
        carrierId: carrier.id.sql,
        fk: this.column(meta, spec.prop),
        carrierOrgs: carrier.orgs,
      };
    }
    if (!nodes.get(spec.aType) || !nodes.get(spec.bType)) return null;
    const meta = this.metadata(spec.entity);
    const org = this.findColumn(meta, 'organizationId');
    return {
      kind: 'junction',
      spec,
      table: ident(meta.tableName),
      a: this.column(meta, spec.aProp),
      b: this.column(meta, spec.bProp),
      org: org ? ident(org.databaseName) : null,
    };
  }

  // ── Metadata helpers ─────────────────────────────────────────────────────────

  private metadata(entity: string): EntityMetadata {
    const meta = this.dataSource.entityMetadatas.find(
      (candidate) => candidate.name === entity || candidate.targetName === entity,
    );
    if (!meta) throw new Error(`no entity "${entity}"`);
    return meta;
  }

  /**
   * A property's column. A relation property (`customer`) resolves to its join column
   * (`customer_id`), so a spec can name either the scalar or the relation.
   */
  private findColumn(meta: EntityMetadata, prop: string): ColumnMetadata | undefined {
    const direct = meta.columns.find((column) => column.propertyName === prop);
    if (direct) return direct;
    const relation = meta.relations.find((candidate) => candidate.propertyName === prop);
    return relation?.joinColumns[0];
  }

  private columnName(meta: EntityMetadata, prop: string): string {
    const column = this.findColumn(meta, prop);
    if (!column) throw new Error(`no property "${prop}" on ${meta.name}`);
    return ident(column.databaseName);
  }

  private column(meta: EntityMetadata, prop: string): ResolvedColumn {
    const column = this.findColumn(meta, prop);
    if (!column) throw new Error(`no property "${prop}" on ${meta.name}`);
    return { sql: ident(column.databaseName), cast: isUuidColumn(column) ? 'uuid' : 'text' };
  }
}

function isUuidColumn(column: ColumnMetadata): boolean {
  if (column.type === 'uuid' || column.generationStrategy === 'uuid') return true;
  // A relation join column takes the type of the column it references.
  const referenced = column.referencedColumn;
  return !!referenced && (referenced.type === 'uuid' || referenced.generationStrategy === 'uuid');
}

/** Refuse anything that is not a plain identifier before it is quoted into SQL. */
export function ident(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`unsafe identifier "${name}"`);
  return name;
}

function describeEdge(spec: EdgeSpec): string {
  return spec.kind === 'fk'
    ? `${spec.carrier}.${spec.prop} → ${spec.target}`
    : `${spec.entity}(${spec.aType} ↔ ${spec.bType})`;
}
