import { findDuplicates, nameSimilarity, normaliseName, normalisePhone } from './duplicate-matching';

describe('duplicate matching', () => {
  it('compares names without accents, punctuation or legal suffixes', () => {
    expect(normaliseName('Distribuidora Peña, S.R.L.')).toBe('distribuidora pena');
    expect(normaliseName('DISTRIBUIDORA PENA SRL')).toBe('distribuidora pena');
    expect(nameSimilarity('distribuidora pena', 'distribuidora pena')).toBe(1);
    expect(nameSimilarity('farmacia carol', 'ferreteria ochoa')).toBeLessThan(0.2);
  });

  it('reads a phone by its subscriber number', () => {
    expect(normalisePhone('+1 (809) 555-1234')).toBe(normalisePhone('809-555-1234'));
    expect(normalisePhone('123')).toBeNull();
  });

  it('finds the same company written twice, and says why', () => {
    const pairs = findDuplicates([
      { id: '1', name: 'Distribuidora Peña, S.R.L.', email: 'compras@pena.do' },
      { id: '2', name: 'DISTRIBUIDORA PENA SRL', email: 'Compras@Pena.do ' },
      { id: '3', name: 'Ferretería Ochoa' },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: { id: '1' }, b: { id: '2' } });
    expect(pairs[0].reasons).toEqual(expect.arrayContaining(['similar_name', 'same_email']));
  });

  it('takes the same tax id as all but conclusive, whatever the names', () => {
    const [pair] = findDuplicates([
      { id: 'a', name: 'Inversiones XYZ', taxId: '1-01-12345-6' },
      { id: 'b', name: 'XYZ Comercial', taxId: '101123456' },
    ]);
    expect(pair).toMatchObject({ score: 0.98, reasons: expect.arrayContaining(['same_tax_id']) });
  });

  it('keeps two taxpayers apart however alike their names', () => {
    expect(
      findDuplicates([
        { id: 'a', name: 'Supermercado Bravo', taxId: '101000001' },
        { id: 'b', name: 'Supermercado Bravo', taxId: '101000002' },
      ]),
    ).toEqual([]);
  });

  it('matches products by barcode', () => {
    const [pair] = findDuplicates([
      { id: 'p1', name: 'Arroz Selecto 5 lb', barcode: '7460000000017' },
      { id: 'p2', name: 'Arroz selecto 5lb.', barcode: '7460000000017' },
    ]);
    expect(pair.reasons).toContain('same_barcode');
  });

  it('does not compare a whole book through a common word', () => {
    const records = Array.from({ length: 500 }, (_, i) => ({ id: String(i).padStart(4, '0'), name: `Comercial ${['Alfa', 'Beta', 'Gama', 'Delta'][i % 4]}${i}` }));
    const started = Date.now();
    findDuplicates(records);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
