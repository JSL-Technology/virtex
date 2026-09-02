import { CsvParserService, CsvParseError, ParseOptions } from './csv-parser.service';

/**
 * The importer's job is to refuse what it cannot read.
 *
 * The parser it replaces guessed at everything: `new Date()` for the date, `parseFloat` for the
 * amounts, `|| '0'` for anything blank and `isNaN(x) ? 0 : x` to finish. Every one of these cases
 * used to produce a plausible-looking statement carrying wrong figures.
 */
describe('CsvParserService', () => {
  const parser = new CsvParserService();

  const baseOptions: ParseOptions = {
    date: 'Fecha',
    description: 'Concepto',
    debit: 'Credito',
    credit: 'Debito',
    dateFormat: 'dd/MM/yyyy',
    decimalSeparator: ',',
    positiveAmountIsMoneyIn: true,
  };

  const csv = (body: string) => Buffer.from(body, 'utf-8');

  it('reads a Dominican-format file: dd/MM/yyyy dates and 1.234,56 amounts', async () => {
    const rows = await parser.parse(
      csv(
        [
          'Fecha,Concepto,Debito,Credito',
          '05/03/2026,Deposito de cliente,,"58.750,00"',
          '11/03/2026,Comision por mantenimiento,"1.250,50",',
        ].join('\n'),
      ),
      baseOptions,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: '2026-03-05',
      description: 'Deposito de cliente',
      debit: 58_750,
      credit: 0,
      sourceRow: 2,
    });
    expect(rows[1]).toMatchObject({ date: '2026-03-11', debit: 0, credit: 1_250.5 });
  });

  it('reads the same dates as United States dates when told to', async () => {
    const rows = await parser.parse(
      csv(['Fecha,Concepto,Debito,Credito', '03/04/2026,Deposit,,1000.00'].join('\n')),
      { ...baseOptions, dateFormat: 'MM/dd/yyyy', decimalSeparator: '.' },
    );

    // The same string, eleven months apart. `new Date('03/04/2026')` resolved this silently, one
    // way, for every tenant in every country.
    expect(rows[0].date).toBe('2026-03-04');

    const asLatinAmerican = await parser.parse(
      csv(['Fecha,Concepto,Debito,Credito', '03/04/2026,Deposito,,1000.00'].join('\n')),
      { ...baseOptions, decimalSeparator: '.' },
    );
    expect(asLatinAmerican[0].date).toBe('2026-04-03');
  });

  it('rejects a date it cannot read instead of storing Invalid Date', async () => {
    await expect(
      parser.parse(
        csv(['Fecha,Concepto,Debito,Credito', 'ayer,Deposito,,1000,00'].join('\n')),
        baseOptions,
      ),
    ).rejects.toMatchObject({ reason: 'INVALID_DATE', detail: { row: 2 } });
  });

  it('rejects an amount it cannot read instead of calling it zero', async () => {
    await expect(
      parser.parse(
        csv(['Fecha,Concepto,Debito,Credito', '05/03/2026,Deposito,,mil pesos'].join('\n')),
        baseOptions,
      ),
    ).rejects.toBeInstanceOf(CsvParseError);
  });

  it('rejects a mistyped column name instead of producing a statement of zeroes', async () => {
    await expect(
      parser.parse(
        csv(['Fecha,Concepto,Debito,Credito', '05/03/2026,Deposito,,1000,00'].join('\n')),
        { ...baseOptions, description: 'Descripcion' },
      ),
    ).rejects.toMatchObject({
      reason: 'MISSING_COLUMNS',
      detail: { missing: ['Descripcion'] },
    });
  });

  it('rejects a row with no movement at all', async () => {
    await expect(
      parser.parse(
        csv(['Fecha,Concepto,Debito,Credito', '05/03/2026,Saldo anterior,,'].join('\n')),
        baseOptions,
      ),
    ).rejects.toMatchObject({ reason: 'INVALID_AMOUNT', detail: { reason: 'ZERO' } });
  });

  it('reads a single signed amount column, in either convention', async () => {
    const asHeld = await parser.parse(
      csv(['Fecha,Concepto,Monto', '05/03/2026,Deposito,1000.00', '06/03/2026,Retiro,-250.00'].join('\n')),
      {
        ...baseOptions,
        debit: undefined,
        credit: undefined,
        amount: 'Monto',
        decimalSeparator: '.',
      },
    );
    expect(asHeld[0]).toMatchObject({ debit: 1000, credit: 0 });
    expect(asHeld[1]).toMatchObject({ debit: 0, credit: 250 });

    // Some banks state the movement from their own side, where a deposit is negative.
    const asBankStates = await parser.parse(
      csv(['Fecha,Concepto,Monto', '05/03/2026,Deposito,-1000.00'].join('\n')),
      {
        ...baseOptions,
        debit: undefined,
        credit: undefined,
        amount: 'Monto',
        decimalSeparator: '.',
        positiveAmountIsMoneyIn: false,
      },
    );
    expect(asBankStates[0]).toMatchObject({ debit: 1000, credit: 0 });
  });

  it('reads an amount in parentheses as negative, and strips the currency symbol', async () => {
    const rows = await parser.parse(
      csv(['Fecha,Concepto,Monto', '05/03/2026,Cargo,"(RD$ 1.500,25)"'].join('\n')),
      { ...baseOptions, debit: undefined, credit: undefined, amount: 'Monto' },
    );
    expect(rows[0]).toMatchObject({ debit: 0, credit: 1_500.25 });
  });

  it('refuses a file with no amount mapping at all', async () => {
    await expect(
      parser.parse(csv(['Fecha,Concepto', '05/03/2026,Deposito'].join('\n')), {
        ...baseOptions,
        debit: undefined,
        credit: undefined,
        amount: undefined,
      }),
    ).rejects.toMatchObject({ reason: 'MISSING_COLUMNS' });
  });

  it('refuses an empty file', async () => {
    await expect(
      parser.parse(csv('Fecha,Concepto,Debito,Credito\n'), baseOptions),
    ).rejects.toMatchObject({ reason: 'NO_ROWS' });
  });
});
