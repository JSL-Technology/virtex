import { DataSource } from 'typeorm';
import { FlowDocumentType } from './contracts/document-flow.contracts';
import { CompiledEdge, CompiledNode, DocumentFlowCatalog } from './document-flow.catalog';
import { EdgeSpec, NODE_SPECS } from './document-flow.specs';
import { DocumentFlowService, FLOW_LIMITS, FlowPrincipal } from './document-flow.service';

/**
 * The traversal engine, against an in-memory database.
 *
 * The catalog here is hand-built over five tiny tables, and the fake `query` understands exactly
 * the three statement shapes the engine emits (describe, incoming FK, junction). That keeps these
 * tests about the walk — direction, limits, tenancy, redaction, the hub rule — rather than about
 * SQL, which `document-flow.specs.spec.ts` and the running app cover.
 */

const T = FlowDocumentType;
const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000bb';
const BRANCH_A = '00000000-0000-4000-8000-00000000000a';
const BRANCH_B = '00000000-0000-4000-8000-00000000000b';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Row = Record<string, string | null>;
let db: Record<string, Row[]>;

function node(type: FlowDocumentType, table: string, links: string[] = [], extra: Partial<CompiledNode> = {}): CompiledNode {
  return {
    spec: NODE_SPECS[type],
    table,
    id: { sql: 'id', cast: 'uuid' },
    orgs: ['organization_id'],
    branch: 'branch_id',
    selects: {
      number: 'doc."number"::text',
      status: 'doc."status"::text',
      total: 'doc."total"::text',
      branch: 'doc."branch_id"::text',
    },
    joins: [],
    links: new Map(links.map((prop) => [prop, prop])),
    ...extra,
  };
}

const NODES = new Map<FlowDocumentType, CompiledNode>([
  [T.SALES_QUOTE, node(T.SALES_QUOTE, 'quotes', ['invoiceId'])],
  [T.SALES_INVOICE, node(T.SALES_INVOICE, 'invoices', ['journalEntryId'])],
  [T.CUSTOMER_PAYMENT, node(T.CUSTOMER_PAYMENT, 'payments', ['journalEntryId'])],
  [T.JOURNAL_ENTRY, node(T.JOURNAL_ENTRY, 'entries', ['reversesEntryId'], { branch: null })],
  [T.PAYROLL_RUN, node(T.PAYROLL_RUN, 'runs', ['journalEntryId'])],
]);

function fk(carrier: FlowDocumentType, prop: string, target: FlowDocumentType, carrierRole: 'source' | 'target', relation: string): CompiledEdge {
  const spec = { kind: 'fk', carrier, prop, target, carrierRole, relation, category: 'flow' } as Extract<EdgeSpec, { kind: 'fk' }>;
  const c = NODES.get(carrier)!;
  return { kind: 'fk', spec, carrierTable: c.table, carrierId: 'id', fk: { sql: prop, cast: 'uuid' }, carrierOrgs: c.orgs };
}

const EDGES: CompiledEdge[] = [
  fk(T.SALES_QUOTE, 'invoiceId', T.SALES_INVOICE, 'source', 'invoiced'),
  fk(T.SALES_INVOICE, 'journalEntryId', T.JOURNAL_ENTRY, 'source', 'posted'),
  fk(T.CUSTOMER_PAYMENT, 'journalEntryId', T.JOURNAL_ENTRY, 'source', 'posted'),
  fk(T.PAYROLL_RUN, 'journalEntryId', T.JOURNAL_ENTRY, 'source', 'posted'),
  fk(T.JOURNAL_ENTRY, 'reversesEntryId', T.JOURNAL_ENTRY, 'target', 'reversed'),
  {
    kind: 'junction',
    spec: { kind: 'junction', entity: 'Line', aProp: 'invoice_id', aType: T.SALES_INVOICE, bProp: 'payment_id', bType: T.CUSTOMER_PAYMENT, sourceSide: 'a', tenantSide: 'b', relation: 'settled_by', category: 'settlement' },
    table: 'payment_lines',
    a: { sql: 'invoice_id', cast: 'uuid' },
    b: { sql: 'payment_id', cast: 'uuid' },
    org: null,
  },
];

const catalog = {
  node: (type: FlowDocumentType) => NODES.get(type),
  nodes: () => [...NODES.values()],
  edges: () => EDGES,
  problems: () => [],
} as unknown as DocumentFlowCatalog;

/** Executes the engine's three statement shapes against `db`. */
async function fakeQuery(sql: string, params: unknown[] = []): Promise<Row[]> {
  if (/^SET TRANSACTION|set_config/.test(sql)) return [];
  const [ids, org, cap] = params as [string[], string, number];

  const describe = /FROM "(\w+)" doc /.exec(sql);
  if (describe) {
    const aliases = [...sql.matchAll(/doc\."(\w+)"::text AS "(\w+)"/g)];
    return (db[describe[1]] ?? [])
      .filter((row) => ids.includes(row['id']!) && row['organization_id'] === org)
      .map((row) => Object.fromEntries(aliases.map(([, column, alias]) => [alias, row[column] ?? null])));
  }

  const incoming = /FROM "(\w+)" c WHERE c\."(\w+)" = ANY/.exec(sql);
  if (incoming) {
    const [, table, column] = incoming;
    return perRef(
      (db[table] ?? [])
        .filter((row) => ids.includes(row[column]!) && row['organization_id'] === org)
        .map((row) => ({ id: row['id'], ref: row[column] })),
      cap,
    );
  }

  const junction = /j\."(\w+)"::text AS id, j\."(\w+)"::text AS ref, .* FROM "(\w+)" j /.exec(sql);
  if (junction) {
    const [, other, self, table] = junction;
    return perRef(
      (db[table] ?? [])
        .filter((row) => ids.includes(row[self]!) && row[other])
        .filter((row) => (db['payments'] ?? []).some((p) => p['id'] === row['payment_id'] && p['organization_id'] === org))
        .map((row) => ({ id: row[other], ref: row[self] })),
      cap,
    );
  }
  throw new Error(`unexpected SQL: ${sql}`);
}

function perRef(rows: Row[], cap: number): Row[] {
  const counts = new Map<string, number>();
  return rows.filter((row) => {
    const n = (counts.get(row['ref']!) ?? 0) + 1;
    counts.set(row['ref']!, n);
    return n <= cap;
  });
}

let branchAccess: string[] = [];
const manager = {
  query: jest.fn(fakeQuery),
  find: jest.fn(async () => branchAccess.map((branchId) => ({ branchId }))),
  findOne: jest.fn(async () => null),
};
const dataSource = {
  transaction: jest.fn(async (_level: string, work: (m: typeof manager) => Promise<unknown>) => work(manager)),
} as unknown as DataSource;

const service = new DocumentFlowService(dataSource, catalog);
const ALL: FlowPrincipal = { organizationId: ORG, userId: id(999), permissions: ['*'] };

function doc(n: number, extra: Row = {}): Row {
  return { id: id(n), organization_id: ORG, number: `N-${n}`, status: null, total: '100.00', branch_id: BRANCH_A, ...extra };
}

/** quote(1) → invoice(2) → entry(3); invoice(2) settled by payment(4) → entry(5). */
function seedChain(): void {
  db = {
    quotes: [doc(1, { invoiceId: id(2), status: 'INVOICED' })],
    invoices: [doc(2, { journalEntryId: id(3), status: 'Partially Paid' })],
    entries: [doc(3, { status: 'Posted' }), doc(5, { status: 'Posted' })],
    payments: [doc(4, { journalEntryId: id(5), status: 'POSTED' })],
    payment_lines: [{ invoice_id: id(2), payment_id: id(4) }],
    runs: [],
  };
}

beforeEach(() => {
  seedChain();
  branchAccess = [];
  manager.query.mockClear();
});

describe('DocumentFlowService.buildMap', () => {
  it('walks the whole chain from the middle, both directions, oriented base → derived', async () => {
    const map = await service.buildMap(T.SALES_INVOICE, id(2), ALL);

    expect(map.root).toBe(`SALES_INVOICE:${id(2)}`);
    expect(map.nodes.map((n) => n.key).sort()).toEqual(
      [`SALES_QUOTE:${id(1)}`, `SALES_INVOICE:${id(2)}`, `JOURNAL_ENTRY:${id(3)}`, `CUSTOMER_PAYMENT:${id(4)}`, `JOURNAL_ENTRY:${id(5)}`].sort(),
    );
    const edges = map.edges.map((e) => `${e.from.split(':')[1].slice(-1)}>${e.to.split(':')[1].slice(-1)}:${e.relation}`).sort();
    expect(edges).toEqual(['1>2:invoiced', '2>3:posted', '2>4:settled_by', '4>5:posted']);
    expect(map.truncated).toBe(false);
  });

  it('colours by the explicit status map and records depth', async () => {
    const map = await service.buildMap(T.SALES_QUOTE, id(1), ALL);
    const byKey = Object.fromEntries(map.nodes.map((n) => [n.key, n]));
    expect(byKey[`SALES_QUOTE:${id(1)}`]).toMatchObject({ statusKind: 'closed', depth: 0, root: true });
    expect(byKey[`SALES_INVOICE:${id(2)}`]).toMatchObject({ statusKind: 'open', depth: 1 });
    expect(byKey[`JOURNAL_ENTRY:${id(5)}`]).toMatchObject({ depth: 3 });
    expect(map.depthReached).toBe(3);
  });

  it('batches by level: statements grow with depth, not with documents', async () => {
    // Twenty quotes all invoiced by the same invoice.
    db['quotes'] = Array.from({ length: 20 }, (_, i) => doc(100 + i, { invoiceId: id(2) }));
    await service.buildMap(T.SALES_INVOICE, id(2), ALL);
    const statements = manager.query.mock.calls.filter(([sql]) => !/^SET|set_config/.test(sql as string)).length;
    expect(statements).toBeLessThan(25);
  });

  it('refuses a document of another tenant as not found', async () => {
    db['invoices'][0]['organization_id'] = OTHER_ORG;
    await expect(service.buildMap(T.SALES_INVOICE, id(2), ALL)).rejects.toMatchObject({ status: 404 });
  });

  it('never draws a neighbour from another tenant', async () => {
    db['payments'][0]['organization_id'] = OTHER_ORG;
    const map = await service.buildMap(T.SALES_INVOICE, id(2), ALL);
    expect(map.nodes.some((n) => n.type === T.CUSTOMER_PAYMENT)).toBe(false);
    expect(map.edges.some((e) => e.relation === 'settled_by')).toBe(false);
  });

  it('refuses a root the caller may not read', async () => {
    await expect(
      service.buildMap(T.SALES_INVOICE, id(2), { ...ALL, permissions: ['relationship_map:view', 'journal_entries:view'] }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('withholds every identifying field of a document whose module the caller cannot read', async () => {
    const map = await service.buildMap(T.SALES_INVOICE, id(2), { ...ALL, permissions: ['invoices:view'] });
    const payment = map.nodes.find((n) => n.type === T.CUSTOMER_PAYMENT)!;
    expect(payment).toMatchObject({ restricted: true, number: null, amount: null, party: null, statusKind: 'unknown', date: null });
    // …but keeps the chain's shape.
    expect(map.edges.some((e) => e.to === payment.key)).toBe(true);
    expect(map.nodes.find((n) => n.type === T.SALES_INVOICE)).toMatchObject({ restricted: false, number: 'N-2' });
  });

  it('withholds documents of a branch outside the caller scope, and refuses such a root', async () => {
    branchAccess = [BRANCH_A];
    db['payments'][0]['branch_id'] = BRANCH_B;
    const map = await service.buildMap(T.SALES_INVOICE, id(2), ALL);
    expect(map.nodes.find((n) => n.type === T.CUSTOMER_PAYMENT)?.restricted).toBe(true);
    // Journal entries have no branch: never restricted by branch.
    expect(map.nodes.filter((n) => n.type === T.JOURNAL_ENTRY).every((n) => !n.restricted)).toBe(true);

    db['invoices'][0]['branch_id'] = BRANCH_B;
    await expect(service.buildMap(T.SALES_INVOICE, id(2), ALL)).rejects.toMatchObject({ status: 403 });
  });

  it('does not fan back out of a journal entry it passed through', async () => {
    // A payroll run posted to the same entry as the invoice — unrelated to the invoice's chain.
    db['runs'] = [doc(7, { journalEntryId: id(3) })];
    const fromInvoice = await service.buildMap(T.SALES_INVOICE, id(2), ALL);
    expect(fromInvoice.nodes.some((n) => n.type === T.PAYROLL_RUN)).toBe(false);

    // Opened on the entry itself, it shows everything posted to it.
    const fromEntry = await service.buildMap(T.JOURNAL_ENTRY, id(3), ALL);
    expect(fromEntry.nodes.some((n) => n.type === T.PAYROLL_RUN)).toBe(true);
    expect(fromEntry.nodes.some((n) => n.type === T.SALES_INVOICE)).toBe(true);
  });

  it('still follows a reversal out of a journal entry it passed through', async () => {
    db['entries'].push(doc(6, { reversesEntryId: id(3), status: 'Posted' }));
    const map = await service.buildMap(T.SALES_INVOICE, id(2), ALL);
    expect(map.edges.some((e) => e.relation === 'reversed' && e.from === `JOURNAL_ENTRY:${id(3)}` && e.to === `JOURNAL_ENTRY:${id(6)}`)).toBe(true);
  });

  it('stops at the depth limit and says so', async () => {
    const map = await service.buildMap(T.SALES_QUOTE, id(1), ALL, { maxDepth: 1 });
    expect(map.nodes.map((n) => n.type).sort()).toEqual([T.SALES_INVOICE, T.SALES_QUOTE].sort());
    expect(map.truncation).toMatchObject({ depth: true, nodes: false });
    expect(map.truncated).toBe(true);
  });

  it('stops at the node cap and says so', async () => {
    db['quotes'] = Array.from({ length: 10 }, (_, i) => doc(100 + i, { invoiceId: id(2) }));
    const map = await service.buildMap(T.SALES_INVOICE, id(2), ALL, { maxNodes: 5 });
    expect(map.nodes).toHaveLength(5);
    expect(map.truncation.nodes).toBe(true);
  });

  it('caps the links of one kind drawn from one document', async () => {
    db['quotes'] = Array.from({ length: FLOW_LIMITS.fanOut + 5 }, (_, i) => doc(1000 + i, { invoiceId: id(2) }));
    const map = await service.buildMap(T.SALES_INVOICE, id(2), ALL, { maxNodes: 400 });
    expect(map.nodes.filter((n) => n.type === T.SALES_QUOTE)).toHaveLength(FLOW_LIMITS.fanOut);
    expect(map.truncation.fanOut).toBe(true);
  });

  it('ignores a malformed id in a link instead of failing the map', async () => {
    db['invoices'][0]['journalEntryId'] = 'not-a-uuid';
    const map = await service.buildMap(T.SALES_INVOICE, id(2), ALL);
    expect(map.nodes.some((n) => n.key === `JOURNAL_ENTRY:${id(3)}`)).toBe(false);
  });

  it('runs read-only in one repeatable-read snapshot with a statement timeout', async () => {
    await service.buildMap(T.SALES_INVOICE, id(2), ALL);
    expect(dataSource.transaction).toHaveBeenCalledWith('REPEATABLE READ', expect.any(Function));
    const first = manager.query.mock.calls.slice(0, 2).map(([sql]) => sql);
    expect(first[0]).toBe('SET TRANSACTION READ ONLY');
    expect(first[1]).toContain('statement_timeout');
  });

  it('turns a statement timeout into a clear error', async () => {
    manager.query.mockImplementationOnce(async () => []).mockImplementationOnce(async () => []).mockImplementationOnce(async () => {
      throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
    });
    await expect(service.buildMap(T.SALES_INVOICE, id(2), ALL)).rejects.toMatchObject({ status: 422 });
  });
});

describe('DocumentFlowService.documentTypes', () => {
  it('lists only the types the caller may read', () => {
    const types = service.documentTypes({ ...ALL, permissions: ['invoices:view'] }).map((t) => t.type);
    expect(types).toEqual([T.SALES_QUOTE, T.SALES_INVOICE]);
  });
});
