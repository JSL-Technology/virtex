import { evaluatePredicate, getPath } from './workflow-predicate';
import { coerceFields, sanitizeContext } from './workflow-context';
import { interpolate } from '../workflow-directory.service';
import { isBlockedAddress } from '../security/safe-webhook';
import { WorkflowNodeType } from './workflow-graph';
import { computeWake, follow, pickConditionEdge, pickEdge } from '../workflow-engine.service';

describe('workflow predicates', () => {
  const context = { amount: 15000, customer: { country: 'DO', name: 'Acme SRL' }, tags: ['vip'], due: '2026-10-20', flag: false };

  it.each([
    [{ var: 'amount', op: 'gt', value: 10000 }, true],
    [{ var: 'amount', op: 'lte', value: '15000' }, true],
    [{ var: 'customer.country', op: 'eq', value: 'DO' }, true],
    [{ var: 'customer.name', op: 'contains', value: 'acme' }, true],
    [{ var: 'customer.name', op: 'starts_with', value: 'ac' }, true],
    [{ var: 'customer.name', op: 'not_contains', value: 'xyz' }, true],
    [{ var: 'tags', op: 'contains', value: 'vip' }, true],
    [{ var: 'customer.country', op: 'in', value: ['DO', 'MX'] }, true],
    [{ var: 'due', op: 'lt', value: '2026-11-01' }, true],
    [{ var: 'missing', op: 'not_exists' }, true],
    [{ var: 'flag', op: 'falsy' }, true],
    [{ var: 'amount', op: 'gt', value: 'abc' }, false],
  ])('%j → %s', (predicate, expected) => {
    expect(evaluatePredicate(predicate as never, context)).toBe(expected);
  });

  it('combines with all / any / not', () => {
    expect(evaluatePredicate({ all: [{ var: 'amount', op: 'gt', value: 1 }, { not: { var: 'flag', op: 'truthy' } }] }, context)).toBe(true);
    expect(evaluatePredicate({ any: [{ var: 'amount', op: 'lt', value: 1 }, { var: 'flag', op: 'truthy' }] }, context)).toBe(false);
  });

  it('never walks into the prototype chain', () => {
    expect(getPath({}, 'constructor.prototype')).toBeUndefined();
    expect(getPath({ a: {} }, 'a.__proto__')).toBeUndefined();
  });
});

describe('workflow context', () => {
  it('drops prototype-polluting keys and non-JSON values', () => {
    const dirty = JSON.parse('{"__proto__":{"polluted":true},"a":1,"fn":null,"nested":{"constructor":1,"ok":"y"}}');
    const clean = sanitizeContext({ ...dirty, when: new Date('2026-01-01T00:00:00Z'), inf: Infinity });
    expect(clean).toEqual({ a: 1, fn: null, nested: { ok: 'y' }, when: '2026-01-01T00:00:00.000Z', inf: null });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('coerces and checks declared fields', () => {
    const { values, problems } = coerceFields(
      [
        { name: 'amount', type: 'number', required: true },
        { name: 'urgent', type: 'boolean' },
        { name: 'kind', type: 'select', options: ['a', 'b'] },
        { name: 'note', type: 'string', required: true },
      ],
      { amount: '1250.5', urgent: 'true', kind: 'c' },
    );
    expect(values['amount']).toBe(1250.5);
    expect(values['urgent']).toBe(true);
    expect(problems).toEqual([
      { field: 'kind', code: 'option' },
      { field: 'note', code: 'required' },
    ]);
  });

  it('interpolates paths and nothing else', () => {
    expect(interpolate('Factura {{invoiceNumber}} por {{ total }} ({{customer.name}}){{nope}}', { invoiceNumber: 'F-1', total: 10, customer: { name: 'Acme' } })).toBe(
      'Factura F-1 por 10 (Acme)',
    );
    expect(interpolate('{{constructor}}', {})).toBe('');
  });
});

describe('webhook SSRF guard', () => {
  it.each(['127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1'])(
    'blocks %s',
    (address) => expect(isBlockedAddress(address)).toBe(true),
  );
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('allows %s', (address) => expect(isBlockedAddress(address)).toBe(false));
});

describe('engine routing helpers', () => {
  const graph = {
    nodes: [
      { id: 'w', type: WorkflowNodeType.TIMER, config: { timerMinutes: 5 } },
      { id: 'c', type: WorkflowNodeType.CONDITION },
      { id: 'a', type: WorkflowNodeType.APPROVAL },
    ],
    edges: [
      { id: '1', from: 'w', to: 'c' },
      { id: '2', from: 'c', to: 'x', condition: { var: 'amount', op: 'gt' as const, value: 10 } },
      { id: '3', from: 'c', to: 'y', default: true },
      { id: '4', from: 'a', to: 'ok', outcome: 'approve' },
      { id: '5', from: 'a', to: 'ko', outcome: 'reject' },
    ],
  };

  it('routes by outcome, condition and default', () => {
    expect(pickEdge(graph, graph.nodes[2], { outcome: 'reject' })?.to).toBe('ko');
    expect(pickConditionEdge(graph, graph.nodes[1], { amount: 50 })?.to).toBe('x');
    expect(pickConditionEdge(graph, graph.nodes[1], { amount: 5 })?.to).toBe('y');
  });

  it('moves a woken timer token past the timer instead of re-arming it', () => {
    const token = { id: 't', nodeId: 'w', state: 'waiting' as const, waitKind: 'timer' as const, wakeAt: '2026-01-01T00:00:00Z' };
    follow(token as never, pickEdge(graph, graph.nodes[0], {}));
    expect(token).toEqual({ id: 't', nodeId: 'c', state: 'active' });
  });

  it('computes a wake time from minutes or a dated variable', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(computeWake(graph.nodes[0] as never, {}, now).toISOString()).toBe('2026-01-01T00:05:00.000Z');
    expect(
      computeWake({ id: 'w', type: WorkflowNodeType.TIMER, config: { timerUntilVar: 'due' } }, { due: '2026-02-01T10:00:00Z' }, now).toISOString(),
    ).toBe('2026-02-01T10:00:00.000Z');
  });
});
