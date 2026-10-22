import { evalCopilot, evalGateway, evalSettings, evalUser } from './harness';
import { COPILOT_CASES } from './cases';

/** The evaluation harness wires the real copilot and gateway; here the provider is a script. */
describe('AI evaluation harness', () => {
  it('takes the API\'s own model defaults from the environment schema', () => {
    const settings = evalSettings({ ANTHROPIC_API_KEY: 'k' });
    expect(settings['AI_MODEL_COPILOT']).toBe(settings['AI_MODEL_VISION']);
    expect(settings['AI_MODEL_LIGHT']).toBe(settings['AI_MODEL_NARRATIVE']);
  });

  it('runs a case end to end: the tool fixtures answer, a draft is recorded and nothing is created', async () => {
    const { gateway, receipts } = evalGateway({ ...evalSettings({ ANTHROPIC_API_KEY: 'k' }) });
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const turns = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'search_products', input: { query: 'gloves' } }] },
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'draft_quote', input: { party_id: 'c', lines: [{ product_id: 'p', quantity: 10, unit_price: null }] } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I drafted the quote for your review.' }] },
    ];
    const next = () => ({ model: 'm', usage, ...turns.shift()! });
    (gateway as unknown as { client: unknown }).client = {
      beta: {
        messages: {
          create: jest.fn(async () => next()),
          stream: jest.fn(() => {
            const message = next();
            return { on: () => undefined, finalMessage: async () => message };
          }),
        },
      },
    };
    const item = COPILOT_CASES.cases.find((candidate) => candidate.id === 'us-quote-on-request-en')!;
    const harness = evalCopilot(gateway, item.tools, item.draftTool);
    const user = evalUser('en');
    const conversation = await harness.copilot.create(user);
    const turn = await harness.copilot.send(user, conversation.id as string, item.question, { text: () => undefined, tool: () => undefined, proposal: () => undefined, chart: () => undefined });
    expect(harness.called).toEqual(['search_products']);
    expect(harness.drafts.map((draft) => draft.tool)).toEqual(['draft_quote']);
    expect(turn.proposals).toHaveLength(1);
    expect(receipts.map((receipt) => receipt.promptId)).toEqual(['copilot.system', 'copilot.system', 'copilot.system']);
    expect(receipts[0].promptHash).toMatch(/^[0-9a-f]{16}$/);
  });
});
