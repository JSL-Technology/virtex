import { supplierInvoiceKey } from './supplier-invoice-key';

describe('supplierInvoiceKey', () => {
  it('compares the same document typed different ways as equal', () => {
    expect(supplierInvoiceKey('FAC-000123')).toBe('FAC123');
    expect(supplierInvoiceKey('fac 123')).toBe('FAC123');
    expect(supplierInvoiceKey('FAC000123')).toBe('FAC123');
    expect(supplierInvoiceKey(' 0045/2026 ')).toBe('452026');
  });

  it('keeps different numbers different', () => {
    expect(supplierInvoiceKey('FAC-123')).not.toBe(supplierInvoiceKey('FAC-1230'));
    expect(supplierInvoiceKey('A-1')).not.toBe(supplierInvoiceKey('B-1'));
    expect(supplierInvoiceKey('0')).toBe('0');
  });

  it('is null when nothing identifying is left', () => {
    expect(supplierInvoiceKey(undefined)).toBeNull();
    expect(supplierInvoiceKey('  - / ')).toBeNull();
  });
});
