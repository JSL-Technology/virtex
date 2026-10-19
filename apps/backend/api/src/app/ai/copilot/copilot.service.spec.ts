import { CopilotService, transcriptEntries } from './copilot.service';
import { CopilotToolRegistry, CopilotUser, s } from '../../contracts/copilot/copilot-tools.contract';
import type { ConverseRequest } from '../gateway/ai-gateway.service';

/**
 * The copilot acts as the person, never as more: it is offered only the tools the person may use,
 * checked again when a tool runs, and a draft tool proposes without writing — the document exists
 * only after the person confirms.
 */
function repo<T extends { id?: string }>() {
  const rows: T[] = [];
  let next = 0;
  // Equality, and TypeORM's `Not(IsNull())` — the only operator the service uses.
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      const op = value as { _type?: string; _value?: { _type?: string } } | null;
      if (op && typeof op === 'object' && op._type === 'not' && op._value?._type === 'isNull') {
        return row[key] !== null && row[key] !== undefined;
      }
      return row[key] === value;
    });
  return {
    rows,
    create: (data: Partial<T>) => ({ ...data }) as T,
    save: jest.fn(async (input: T | T[]) => {
      const list = Array.isArray(input) ? input : [input];
      for (const row of list) {
        const r = row as Record<string, unknown>;
        if (!r['id']) r['id'] = `id-${++next}`;
        if (!r['createdAt']) r['createdAt'] = new Date();
        if (!rows.includes(row)) rows.push(row);
      }
      return input;
    }),
    find: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((row) => matches(row as Record<string, unknown>, where))),
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((row) => matches(row as Record<string, unknown>, where)) ?? null),
    count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((row) => matches(row as Record<string, unknown>, where)).length),
    delete: jest.fn(async ({ id }: { id: string }) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
    }),
  };
}

type Script = (request: ConverseRequest) => Promise<void>;

/** What `sales_trend` reports now; a test changes it to see a pinned chart follow the data. */
let trend: number[] = [100, 250, 175];
const trendCalls: unknown[] = [];

function build(script: Script) {
  const registry = new CopilotToolRegistry();
  const created: unknown[] = [];
  registry.register(
    {
      kind: 'read',
      name: 'receivables_aging',
      description: 'd',
      permissions: ['accounts_receivable:view'],
      inputSchema: s.object({}),
      run: async () => ({ total: 1500 }),
    },
    {
      kind: 'read',
      name: 'sales_trend',
      description: 'd',
      permissions: ['accounts_receivable:view'],
      inputSchema: s.object({ months: s.integer() }),
      run: async (_ctx, input) => {
        trendCalls.push(input);
        return { currency: 'DOP', months: trend.map((total, index) => ({ month: `2026-0${index + 1}`, total })) };
      },
    },
    {
      kind: 'read',
      name: 'payroll_totals',
      description: 'd',
      permissions: ['payroll:view'],
      inputSchema: s.object({}),
      run: async () => ({ secret: true }),
    },
    {
      kind: 'draft',
      name: 'draft_quote',
      description: 'd',
      permissions: ['invoices:create'],
      inputSchema: s.object({ customer_id: s.string() }),
      propose: async () => ({ summary: 'Cotización · total 100', preview: { total: 100 } }),
      commit: async (_ctx, input) => {
        created.push(input);
        return { id: 'q-1', link: '/quotes/q-1/edit', label: 'Cotización COT-1' };
      },
    },
  );
  const offered: string[][] = [];
  const gateway = {
    converse: jest.fn(async (request: ConverseRequest) => {
      offered.push(request.tools.map((tool) => tool.name));
      await script(request);
      return { appended: [{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }], text: 'ok', stopReason: 'end_turn', requestIds: [], model: 'm' };
    }),
  };
  const entitlements = { checkFeature: jest.fn(async () => true) };
  const conversations = repo<Record<string, unknown> & { id?: string }>();
  const messages = repo<Record<string, unknown> & { id?: string }>();
  const actions = repo<Record<string, unknown> & { id?: string }>();
  const charts = repo<Record<string, unknown> & { id?: string }>();
  const service = new CopilotService(
    gateway as never,
    registry,
    entitlements as never,
    conversations as never,
    messages as never,
    actions as never,
    charts as never,
  );
  return { service, gateway, offered, created, conversations, messages, actions, charts };
}

const user: CopilotUser = { id: 'u-1', organizationId: 'org-1', permissions: ['accounts_receivable:view', 'invoices:create'], language: 'es' };
const sink = () => ({ text: jest.fn(), tool: jest.fn(), proposal: jest.fn(), chart: jest.fn() });
const chartInput = (overrides: Record<string, unknown> = {}) => ({
  title: 'Ventas por mes',
  type: 'column',
  source_tool: 'sales_trend',
  source_input_json: '{"months":3}',
  rows: 'months',
  label: 'month',
  series: [{ name: 'Ventas', field: 'total' }],
  unit: 'DOP',
  ...overrides,
});

describe('CopilotService', () => {
  it('offers only the tools the person may use', async () => {
    const { service, offered } = build(async () => undefined);
    const conversation = await service.create(user);
    await service.send(user, conversation.id, '¿cuánto me deben?', sink());
    expect(offered[0]).toEqual(['draft_quote', 'receivables_aging', 'sales_trend', 'show_chart']);
  });

  it('refuses a tool the model names but the person may not use, even if forced', async () => {
    let outcome: unknown;
    const { service } = build(async (request) => {
      outcome = await request.execute('payroll_totals', {});
    });
    const conversation = await service.create(user);
    await service.send(user, conversation.id, 'nómina', sink());
    expect(outcome).toMatchObject({ isError: true });
    expect(JSON.stringify(outcome)).not.toContain('secret');
  });

  it('a draft tool proposes; nothing is created until the person confirms', async () => {
    let result: { content: string } | undefined;
    const { service, created, actions } = build(async (request) => {
      result = await request.execute('draft_quote', { customer_id: 'c-1' });
    });
    const conversation = await service.create(user);
    const events = sink();
    const turn = await service.send(user, conversation.id, 'cotiza', events);

    expect(created).toEqual([]);
    expect(JSON.parse(result!.content)).toMatchObject({ status: 'proposed' });
    expect(events.proposal).toHaveBeenCalledWith(expect.objectContaining({ tool: 'draft_quote', summary: 'Cotización · total 100' }));
    expect(actions.rows[0]).toMatchObject({ status: 'PROPOSED', userId: 'u-1' });

    const confirmed = await service.confirm(user, turn.proposals[0]);
    expect(created).toEqual([{ customer_id: 'c-1' }]);
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', result: { link: '/quotes/q-1/edit' } });
    // Twice is not twice the documents.
    await expect(service.confirm(user, turn.proposals[0])).rejects.toMatchObject({ messageKey: 'ai.copilot.proposal_already_decided' });
    expect(created).toHaveLength(1);
  });

  it('a person who lost the permission cannot confirm an earlier proposal', async () => {
    const { service, created } = build(async (request) => {
      await request.execute('draft_quote', { customer_id: 'c-1' });
    });
    const conversation = await service.create(user);
    const turn = await service.send(user, conversation.id, 'cotiza', sink());
    const demoted = { ...user, permissions: ['accounts_receivable:view'] };
    await expect(service.confirm(demoted, turn.proposals[0])).rejects.toMatchObject({ status: 403 });
    expect(created).toEqual([]);
  });

  it("another user's conversation does not exist for you", async () => {
    const { service } = build(async () => undefined);
    const conversation = await service.create(user);
    const colleague = { ...user, id: 'u-2' };
    await expect(service.send(colleague, conversation.id, 'hola', sink())).rejects.toMatchObject({ status: 404 });
  });

  it('keeps the stored history append-only and tells the model what was decided since', async () => {
    let second: ConverseRequest | undefined;
    let calls = 0;
    const { service, messages } = build(async (request) => {
      calls++;
      if (calls === 1) await request.execute('draft_quote', { customer_id: 'c-1' });
      else second = request;
    });
    const conversation = await service.create(user);
    const turn = await service.send(user, conversation.id, 'cotiza', sink());
    await service.reject(user, turn.proposals[0]);
    await service.send(user, conversation.id, 'gracias', sink());

    expect(messages.rows.map((row) => row['seq'])).toEqual([1, 2, 3, 4]);
    const lastUser = second!.history.at(-1)!;
    expect(JSON.stringify(lastUser.content)).toContain('was rejected');
    // The earlier turns are replayed exactly as stored.
    expect(second!.history.slice(0, 2)).toEqual(messages.rows.slice(0, 2).map((row) => ({ role: row['role'], content: row['content'] })));
  });
});

describe('CopilotService charts', () => {
  beforeEach(() => {
    trend = [100, 250, 175];
    trendCalls.length = 0;
  });

  it('draws a chart from the source tool itself, as the person, never from figures the model typed', async () => {
    let outcome: { content: string; isError?: boolean } | undefined;
    const { service, charts } = build(async (request) => {
      // A figure in the call is ignored: there is nowhere in the schema to put one.
      outcome = await request.execute('show_chart', chartInput());
    });
    const conversation = await service.create(user);
    const events = sink();
    const turn = await service.send(user, conversation.id, 'gráfico de ventas', events);

    expect(outcome?.isError).toBeFalsy();
    expect(trendCalls).toEqual([{ months: 3 }]);
    expect(events.chart).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Ventas por mes',
        type: 'column',
        pinned: false,
        data: expect.objectContaining({
          categories: ['2026-01', '2026-02', '2026-03'],
          series: [{ name: 'Ventas', values: [100, 250, 175] }],
          unit: 'DOP',
        }),
      }),
    );
    expect(charts.rows[0]).toMatchObject({ userId: 'u-1', conversationId: conversation.id, sourceTool: 'sales_trend' });
    expect(turn.toolsUsed).toEqual(expect.arrayContaining(['show_chart', 'sales_trend']));
  });

  it('will not draw from a tool the person may not use, nor a mapping that does not match', async () => {
    const outcomes: Array<{ content: string; isError?: boolean }> = [];
    const { service, charts } = build(async (request) => {
      outcomes.push(await request.execute('show_chart', chartInput({ source_tool: 'payroll_totals', rows: '', label: 'x' })));
      outcomes.push(await request.execute('show_chart', chartInput({ series: [{ name: 'X', field: 'missing' }] })));
    });
    const conversation = await service.create(user);
    await service.send(user, conversation.id, 'nómina', sink());

    expect(outcomes.map((o) => o.isError)).toEqual([true, true]);
    expect(outcomes[0].content).toContain('not one of your read tools');
    expect(outcomes[0].content).not.toContain('secret');
    expect(JSON.parse(outcomes[1].content).error).toContain('"missing"');
    expect(charts.rows).toEqual([]);
  });

  it('a pinned chart is drawn again from live data each time, and only while the person may see it', async () => {
    const { service } = build(async (request) => {
      await request.execute('show_chart', chartInput());
    });
    const conversation = await service.create(user);
    await service.send(user, conversation.id, 'gráfico', sink());
    const [{ id }] = (await service.transcript(user, conversation.id)).charts;

    expect(await service.pin(user, id)).toMatchObject({ pinned: true });
    trend = [300, 310, 320];
    const [live] = await service.pinned(user);
    expect(live.data?.series[0].values).toEqual([300, 310, 320]);

    const demoted = { ...user, permissions: ['invoices:create'] };
    expect(await service.pinned(demoted)).toEqual([expect.objectContaining({ id, data: null, unavailable: 'not_allowed' })]);

    await service.unpin(user, id);
    expect(await service.pinned(user)).toEqual([]);
    // Someone else's chart is not yours to pin.
    await expect(service.pin({ ...user, id: 'u-2' }, id)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps a dashboard to a dozen pinned charts', async () => {
    const { service } = build(async (request) => {
      for (let i = 0; i < 13; i++) await request.execute('show_chart', chartInput({ title: `G${i}` }));
    });
    const conversation = await service.create(user);
    await service.send(user, conversation.id, 'muchos', sink());
    const { charts } = await service.transcript(user, conversation.id);
    for (const chart of charts.slice(0, 12)) await service.pin(user, chart.id);
    await expect(service.pin(user, charts[12].id)).rejects.toMatchObject({ messageKey: 'ai.copilot.chart_pin_limit' });
  });
});

describe('transcriptEntries', () => {
  const at = (seconds: number) => new Date(Date.UTC(2026, 9, 1, 12, 0, seconds));

  it('folds an answer and its tool rounds into one entry, and attaches the proposal to it', () => {
    const rows = [
      { seq: 1, role: 'user' as const, content: [{ type: 'text', text: '[Context — today: x]\n\ncotiza' }], toolsUsed: [], createdAt: at(10) },
      { seq: 2, role: 'assistant' as const, content: [{ type: 'text', text: 'Preparo. ' }, { type: 'tool_use', name: 'draft_quote' }], toolsUsed: ['draft_quote'], createdAt: at(10) },
      { seq: 3, role: 'user' as const, content: [{ type: 'tool_result', content: '{}' }], toolsUsed: [], createdAt: at(10) },
      { seq: 4, role: 'assistant' as const, content: [{ type: 'text', text: 'Listo.' }], toolsUsed: [], createdAt: at(10) },
    ];
    const entries = transcriptEntries(rows, [{ id: 'p-1', createdAt: at(5) }]);
    expect(entries).toEqual([
      { seq: 1, role: 'user', text: 'cotiza', toolsUsed: [], proposals: [], charts: [] },
      { seq: 2, role: 'assistant', text: 'Preparo. Listo.', toolsUsed: ['draft_quote'], proposals: ['p-1'], charts: [] },
    ]);
  });

  it('attaches a chart to the answer that drew it', () => {
    const rows = [
      { seq: 1, role: 'user' as const, content: 'ventas', toolsUsed: [], createdAt: at(10) },
      { seq: 2, role: 'assistant' as const, content: [{ type: 'text', text: 'Aquí.' }], toolsUsed: ['show_chart'], createdAt: at(10) },
    ];
    expect(transcriptEntries(rows, [], [{ id: 'g-1', createdAt: at(5) }]).at(-1)).toMatchObject({ charts: ['g-1'] });
  });

  it('keeps the proposals of a turn that failed before it was stored', () => {
    const rows = [{ seq: 1, role: 'user' as const, content: 'hola', toolsUsed: [], createdAt: at(1) }];
    const entries = transcriptEntries(rows, [{ id: 'p-9', createdAt: at(30) }]);
    expect(entries.at(-1)).toMatchObject({ role: 'assistant', proposals: ['p-9'] });
  });
});
