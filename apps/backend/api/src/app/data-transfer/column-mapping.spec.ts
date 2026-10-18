import { applyMapping, deterministicMapping, missingRequired, normaliseHeader } from './column-mapping';

const columns = [
  { key: 'name', property: 'companyName', required: true },
  { key: 'tax_id', property: 'taxId' },
  { key: 'email', property: 'email' },
];

describe('import column mapping', () => {
  it('reads a key however it is written', () => {
    expect(normaliseHeader('  Tax-ID ')).toBe('tax_id');
    expect(deterministicMapping(['NAME', 'Tax ID', 'Correo'], columns)).toEqual({ NAME: 'name', 'Tax ID': 'tax_id', Correo: null });
  });

  it('says which required keys nothing maps to', () => {
    expect(missingRequired({ RNC: 'tax_id' }, columns)).toEqual(['name']);
  });

  it('renames the confirmed headers and drops the rest', () => {
    const result = applyMapping(
      ['cliente', 'rnc', 'notas'],
      [{ cliente: 'Peña SRL', rnc: '101123456', notas: 'x' }],
      { cliente: 'name', rnc: 'tax_id', notas: null },
      columns,
    );
    expect(result).toEqual({ headers: ['name', 'tax_id'], rows: [{ name: 'Peña SRL', tax_id: '101123456' }], problem: null });
  });

  it('refuses a key the dataset lacks, or two headers sent to one key', () => {
    expect(applyMapping(['a'], [], { a: 'salary' }, columns).problem).toMatchObject({ key: 'data_transfer.mapping_unknown_key' });
    expect(applyMapping(['a', 'b'], [], { a: 'name', b: 'name' }, columns).problem).toMatchObject({ key: 'data_transfer.mapping_duplicate_key' });
  });
});
