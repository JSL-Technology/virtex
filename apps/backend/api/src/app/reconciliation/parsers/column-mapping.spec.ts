import { inferDateFormat, inferDecimalSeparator, mappingProblems, proposeMapping, readSample } from './column-mapping';

const csv = (text: string) => readSample(Buffer.from(text));

describe('proposed CSV column mapping', () => {
  it('reads a Dominican bank export: day-first dates, comma decimals, credit is money in', () => {
    const sample = csv(
      'Fecha;Descripción;Referencia;Débito;Crédito;Balance\n' +
        '03/10/2026;DEPOSITO TRANSFERENCIA;001;;15.000,00;65.000,00\n' +
        '15/10/2026;CARGO COMISION;002;350,50;;64.649,50\n',
    );
    const mapping = proposeMapping(sample);
    expect(mapping).toMatchObject({
      date: 'Fecha',
      description: 'Descripción',
      reference: 'Referencia',
      moneyIn: 'Crédito',
      moneyOut: 'Débito',
      amount: null,
      dateFormat: 'dd/MM/yyyy',
      decimalSeparator: ',',
    });
    expect(mappingProblems(mapping, sample)).toEqual([]);
  });

  it('a single signed amount column, English headers, month-first dates', () => {
    const sample = csv('Date,Description,Amount\n10/25/2026,Wire in,1500.00\n10/26/2026,Card fee,-12.30\n');
    expect(proposeMapping(sample)).toMatchObject({ date: 'Date', description: 'Description', amount: 'Amount', dateFormat: 'MM/dd/yyyy', decimalSeparator: '.' });
  });

  it('says what is missing instead of guessing', () => {
    const sample = csv('Col1,Col2,Col3\n2026-10-01,x,10\n');
    expect(mappingProblems(proposeMapping(sample), sample)).toEqual(expect.arrayContaining(['date', 'description', 'amount']));
  });

  it('infers formats from the values themselves', () => {
    expect(inferDateFormat(['01/02/2026', '13/02/2026'])).toBe('dd/MM/yyyy');
    expect(inferDateFormat(['2026-10-01'])).toBe('yyyy-MM-dd');
    expect(inferDateFormat(['ayer'])).toBeNull();
    expect(inferDecimalSeparator(['1.234,56', '10,00'])).toBe(',');
    expect(inferDecimalSeparator(['1,234.56'])).toBe('.');
  });
});
