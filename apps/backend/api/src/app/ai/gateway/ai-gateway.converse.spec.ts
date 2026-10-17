import { AiGatewayService, numbersNotInFacts } from './ai-gateway.service';

/**
 * The copilot's loop and the reminder writer's guard: tools run between model turns, every turn is
 * paid and recorded, and a text that states a figure not in its facts is refused.
 */
const settings: Record<string, unknown> = {
  ANTHROPIC_API_KEY: 'sk-test',
  AI_ENABLED: true,
  AI_MODEL_VISION: 'claude-opus-5-5',
  AI_MODEL_NARRATIVE: 'claude-opus-5-5',
  AI_MODEL_DEEP_ANALYSIS: 'claude-fable-5-1',
};

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function build() {
  const saved: Array<Record<string, unknown>> = [];
  const requests = {
    create: jest.fn((row) => row),
    save: jest.fn(async (row) => {
      saved.push(row);
      return { ...row, id: `req-${saved.length}` };
    }),
  };
  const entitlements = { consume: jest.fn().mockResolvedValue(undefined), checkFeature: jest.fn() };
  const service = new AiGatewayService({ get: (key: string) => settings[key] } as never, entitlements as never, requests as never);
  const create = jest.fn();
  (service as unknown as { client: unknown }).client = { beta: { messages: { create } } };
  return { service, create, saved, entitlements };
}

const tools = [{ name: 'receivables_aging', description: 'd', inputSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] } }];

describe('AiGatewayService.converse', () => {
  it('runs the tools the model asks for, feeds the results back, and stops when it answers', async () => {
    const { service, create, saved, entitlements } = build();
    create
      .mockResolvedValueOnce({
        model: 'claude-opus-5-5',
        stop_reason: 'tool_use',
        usage,
        content: [
          { type: 'text', text: 'Consulto. ' },
          { type: 'tool_use', id: 'tu_1', name: 'receivables_aging', input: { as_of: null } },
        ],
      })
      .mockResolvedValueOnce({ model: 'claude-opus-5-5', stop_reason: 'end_turn', usage, content: [{ type: 'text', text: 'Te deben 1,500.' }] });
    const execute = jest.fn(async () => ({ content: JSON.stringify({ total: 1500 }) }));

    const result = await service.converse({
      feature: 'copilot',
      organizationId: 'org-1',
      userId: 'u-1',
      system: 'stable',
      history: [{ role: 'user', content: 'cuanto me deben' }],
      tools,
      execute,
    });

    expect(execute).toHaveBeenCalledWith('receivables_aging', { as_of: null });
    expect(result.stopReason).toBe('end_turn');
    expect(result.text).toBe('Consulto. Te deben 1,500.');
    // assistant (tool call), user (tool result), assistant (answer)
    expect(result.appended.map((turn) => turn.role)).toEqual(['assistant', 'user', 'assistant']);
    const second = create.mock.calls[1][0];
    expect(second.messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1', is_error: false });
    // Strict tools, auto choice, cached system prompt.
    expect(second.tools[0].strict).toBe(true);
    expect(second.tool_choice).toEqual({ type: 'auto' });
    expect(second.system[0].cache_control).toEqual({ type: 'ephemeral' });
    // Two model turns: two charges, two receipts.
    expect(entitlements.consume).toHaveBeenCalledTimes(2);
    expect(saved).toHaveLength(2);
  });

  it('returns a failing tool to the model as an error instead of aborting the turn', async () => {
    const { service, create } = build();
    create
      .mockResolvedValueOnce({ model: 'm', stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: 't', name: 'x', input: {} }] })
      .mockResolvedValueOnce({ model: 'm', stop_reason: 'end_turn', usage, content: [{ type: 'text', text: 'No pude.' }] });
    await service.converse({
      feature: 'copilot', organizationId: 'o', userId: 'u', system: 's', history: [{ role: 'user', content: 'q' }], tools,
      execute: async () => {
        throw new Error('boom');
      },
    });
    expect(create.mock.calls[1][0].messages.at(-1).content[0]).toMatchObject({ is_error: true });
  });

  it('stops after the turn limit rather than paying for an endless loop', async () => {
    const { service, create, entitlements } = build();
    create.mockResolvedValue({ model: 'm', stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: 't', name: 'x', input: {} }] });
    const result = await service.converse({
      feature: 'copilot', organizationId: 'o', userId: 'u', system: 's', history: [{ role: 'user', content: 'q' }], tools,
      execute: async () => ({ content: '{}' }), maxTurns: 3,
    });
    expect(result.stopReason).toBe('max_turns');
    expect(entitlements.consume).toHaveBeenCalledTimes(3);
  });

  it('a refusal ends the turn without running anything', async () => {
    const { service, create, saved } = build();
    create.mockResolvedValue({ model: 'm', stop_reason: 'refusal', usage, content: [{ type: 'tool_use', id: 't', name: 'x', input: {} }] });
    const execute = jest.fn();
    const result = await service.converse({
      feature: 'copilot', organizationId: 'o', userId: 'u', system: 's', history: [{ role: 'user', content: 'q' }], tools, execute,
    });
    expect(result.stopReason).toBe('refusal');
    expect(execute).not.toHaveBeenCalled();
    expect(saved[0]).toMatchObject({ status: 'REFUSED' });
  });
});

describe('numbersNotInFacts', () => {
  const facts = { balance: 'RD$1,500.00', dueDate: '2026-11-05', invoices: 2 };

  it('accepts the facts however they are formatted, and small counting numbers', () => {
    expect(numbersNotInFacts('Su saldo de RD$1.500,00 venció el 2026-11-05; son 2 facturas y 3 días.', facts)).toEqual([]);
    expect(numbersNotInFacts('Balance 1500 due 11/05/2026', facts)).toEqual([]);
  });

  it('catches a figure the facts do not contain', () => {
    expect(numbersNotInFacts('Su saldo es RD$15,000.00', facts)).toEqual(['15,000.00']);
  });
});
