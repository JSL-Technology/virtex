import type Anthropic from '@anthropic-ai/sdk';
import { MAX_HISTORY_CHARS, STALE_RESULT_NOTE, historyForModel, maskIdentifiers } from './copilot-history';

type Message = Anthropic.Beta.Messages.BetaMessageParam;

const question = (text: string): Message => ({ role: 'user', content: [{ type: 'text', text }] });
const call = (id: string, name: string): Message => ({ role: 'assistant', content: [{ type: 'tool_use', id, name, input: {} }] });
const result = (id: string, content: string): Message => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] });
const answer = (text: string): Message => ({ role: 'assistant', content: [{ type: 'text', text }] });

const conversation: Message[] = [
  question('¿balance?'), call('t1', 'balance_sheet'), result('t1', '{"assets":900}'), answer('ok'),
  question('¿cuánto me deben?'), call('t2', 'receivables_aging'), result('t2', '{"total":1500}'), answer('ok'),
  question('¿y la caja?'), call('t3', 'cash_position'), result('t3', '{"cash":70}'), answer('ok'),
];
const resultOf = (messages: Message[], id: string) =>
  (messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])) as unknown as Array<Record<string, unknown>>).find(
    (block) => block['tool_use_id'] === id,
  )?.['content'];

describe('historyForModel', () => {
  const all = new Set(['balance_sheet', 'receivables_aging', 'cash_position']);

  it('keeps only the last questions\' tool results verbatim', () => {
    const sent = historyForModel(conversation, all);
    expect(resultOf(sent, 't1')).toBe(STALE_RESULT_NOTE);
    expect(resultOf(sent, 't2')).toBe('{"total":1500}');
    expect(resultOf(sent, 't3')).toBe('{"cash":70}');
  });

  it('does not replay what a withdrawn permission read', () => {
    const sent = historyForModel(conversation, new Set(['cash_position']));
    expect(resultOf(sent, 't2')).toBe(STALE_RESULT_NOTE);
    expect(resultOf(sent, 't3')).toBe('{"cash":70}');
  });

  it('drops the oldest whole exchanges when the history no longer fits, starting at a question', () => {
    const big = 'x'.repeat(MAX_HISTORY_CHARS / 2);
    const long = [question(big), answer('a'), question(big), answer('b'), question('last'), answer('c')];
    const sent = historyForModel(long, all);
    expect(JSON.stringify(sent).length).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
    expect(sent[0].role).toBe('user');
    expect(sent[sent.length - 1]).toEqual(answer('c'));
  });

  it('leaves the stored rows untouched', () => {
    const copy = JSON.stringify(conversation);
    historyForModel(conversation, new Set());
    expect(JSON.stringify(conversation)).toBe(copy);
  });
});

describe('maskIdentifiers', () => {
  it('masks identifiers, e-mails and bank numbers at any depth, keeping the last four', () => {
    expect(
      maskIdentifiers({
        items: [{ id: 'c-1', name: 'Caribe SRL', taxId: '131246753', email: 'pagos@caribe.com.do', total: 1500 }],
        bank: { accountNumber: '9600-1234-5678' },
      }),
    ).toEqual({
      items: [{ id: 'c-1', name: 'Caribe SRL', taxId: '•••6753', email: 'p•••@•••.do', total: 1500 }],
      bank: { accountNumber: '•••5678' },
    });
  });
});
