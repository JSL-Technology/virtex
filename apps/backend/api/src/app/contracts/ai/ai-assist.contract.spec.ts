import { redactSampleCell } from './ai-assist.contract';

describe('redactSampleCell', () => {
  it('keeps the shape of a column, not the numbers and addresses in it', () => {
    expect(redactSampleCell('TRANSF 9600-1234-5678 a pagos@caribe.com.do')).toBe('TRANSF •••5678 a x@x.xx');
    // Amounts and dates are what tells one column from another: left as they are.
    expect(redactSampleCell('1,500.00')).toBe('1,500.00');
    expect(redactSampleCell('2026-10-01')).toBe('2026-10-01');
    expect(redactSampleCell('-25000.75')).toBe('-25000.75');
  });
});
