import { recordLabelOf } from './audit.service';

describe('recordLabelOf', () => {
  it('names a document by its number and name', () => {
    expect(recordLabelOf({ newValue: { number: 'AJ-0007', description: 'QA-Conteo' }, previousValue: undefined })).toBe('AJ-0007 — QA-Conteo');
  });

  it('reads a deleted record from the snapshot it left', () => {
    expect(recordLabelOf({ newValue: null, previousValue: { code: '4300', name: 'Descuentos' } })).toBe('4300 — Descuentos');
  });

  it('prefers the values after the change', () => {
    expect(recordLabelOf({ newValue: { name: 'Nuevo' }, previousValue: { name: 'Viejo' } })).toBe('Nuevo');
  });

  it('admits there is no name rather than inventing one', () => {
    expect(recordLabelOf({ newValue: { status: 'POSTED' }, previousValue: undefined })).toBeNull();
  });
});
