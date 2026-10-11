import { exportBaseName } from './detail.page';

describe('exportBaseName', () => {
  it('names every export of an issued document by its fiscal number', () => {
    expect(exportBaseName({ fiscalNumber: 'E310000000001', invoiceNumber: 'FAC-00000001' })).toBe('E310000000001');
  });

  it('uses the internal number before the document has a fiscal one', () => {
    expect(exportBaseName({ fiscalNumber: null, invoiceNumber: 'FAC-00000001' })).toBe('FAC-00000001');
  });

  it('keeps the name safe for a file system', () => {
    expect(exportBaseName({ invoiceNumber: 'A/B 1' })).toBe('A-B-1');
  });
});
