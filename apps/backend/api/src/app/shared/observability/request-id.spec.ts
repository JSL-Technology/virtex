import { requestIdFrom } from './request-id';

describe('requestIdFrom', () => {
  it('keeps an id the caller sent when it looks like one', () => {
    expect(requestIdFrom({ 'x-request-id': 'b2c4e7a0-1f2e-4c3d-9a8b-7c6d5e4f3a21' })).toBe('b2c4e7a0-1f2e-4c3d-9a8b-7c6d5e4f3a21');
    expect(requestIdFrom({ 'x-correlation-id': 'lb-req.0001:abc' })).toBe('lb-req.0001:abc');
  });

  it('replaces anything that could inject into the logs, or is missing', () => {
    for (const bad of ['abc', 'x\ny-forged-line-0000', '"}{"level":"error"', 'a'.repeat(200)]) {
      expect(requestIdFrom({ 'x-request-id': bad })).not.toBe(bad);
    }
    expect(requestIdFrom({})).toMatch(/^[0-9a-f-]{36}$/);
  });
});
