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
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
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
    delete: jest.fn(),
  };
}

type Script = (request: ConverseRequest) => Promise<void>;

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
  const service = new CopilotService(gateway as never, registry, entitlements as never, conversations as never, messages as never, actions as never);
  return { service, gateway, offered, created, conversations, messages, actions };
}

const user: CopilotUser = { id: 'u-1', organizationId: 'org-1', permissions: ['accounts_receivable:view', 'invoices:create'], language: 'es' };
const sink = () => ({ text: jest.fn(), tool: jest.fn(), proposal: jest.fn() });

describe('CopilotService', () => {
  it('offers only the tools the person may use', async () => {
    const { service, offered } = build(async () => undefined);
    const conversation = await service.create(user);
    await service.send(user, conversation.id, '¿cuánto me deben?', sink());
    expect(offered[0]).toEqual(['draft_quote', 'receivables_aging']);
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
      { seq: 1, role: 'user', text: 'cotiza', toolsUsed: [], proposals: [] },
      { seq: 2, role: 'assistant', text: 'Preparo. Listo.', toolsUsed: ['draft_quote'], proposals: ['p-1'] },
    ]);
  });

  it('keeps the proposals of a turn that failed before it was stored', () => {
    const rows = [{ seq: 1, role: 'user' as const, content: 'hola', toolsUsed: [], createdAt: at(1) }];
    const entries = transcriptEntries(rows, [{ id: 'p-9', createdAt: at(30) }]);
    expect(entries.at(-1)).toMatchObject({ role: 'assistant', proposals: ['p-9'] });
  });
});
