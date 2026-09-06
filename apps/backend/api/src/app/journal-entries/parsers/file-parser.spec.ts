import * as ExcelJS from 'exceljs';
import { FileParserService } from './file-parser.service';
import { FastifyFile } from '../../common/interfaces/fastify-file.interface';

/**
 * Reading an uploaded spreadsheet or CSV into rows.
 *
 * ## Why the library changed
 *
 * `xlsx@0.18.5` — the version the npm registry serves — carries two HIGH advisories that
 * `npm audit` reports by name: prototype pollution (GHSA-4r6h-8v6p-xvw6, fixed in 0.19.3) and a
 * regular-expression denial of service (GHSA-5pgg-2g8v-p4x9, fixed in 0.20.2). Both are in the
 * parsing path, and the parsing path is an authenticated file upload. The registry copy is frozen
 * at 0.18.5, so there was no version to move to.
 *
 * ## And the defect that came with it
 *
 * `XLSX.utils.sheet_to_json` omits empty cells, and the headers were taken from
 * `Object.keys(data[0])` — so a column whose *first* data row happened to be blank vanished from
 * the header list. A mapping screen then offered the wrong columns, and a mapping that points at
 * the wrong column posts real money to the wrong account.
 */
describe('FileParserService', () => {
  const parser = new FileParserService();

  const asFile = (buffer: Buffer, mimetype: string): FastifyFile =>
    ({ buffer, mimetype } as FastifyFile);

  const CSV = 'text/csv';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  /** A workbook built in memory, so the test states exactly what the file contains. */
  async function workbook(
    rows: (string | number | Date | null)[][],
  ): Promise<Buffer> {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Diario');
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await book.xlsx.writeBuffer());
  }

  describe('CSV', () => {
    it('reads the header and the rows', async () => {
      const result = await parser.parse(
        asFile(Buffer.from('Fecha,Concepto,Debe\n10/03/2026,Venta,"58.750,00"\n'), CSV),
        undefined,
      );

      expect(result.headers).toEqual(['Fecha', 'Concepto', 'Debe']);
      expect(result.data).toEqual([
        { Fecha: '10/03/2026', Concepto: 'Venta', Debe: '58.750,00' },
      ]);
    });

    /**
     * Excel writes a byte-order mark ahead of a UTF-8 CSV. Without stripping it the first column
     * is named `﻿Fecha`, which no mapping can ever match — and the failure looks like a typo
     * in the user's own file.
     */
    it('strips the byte-order mark Excel writes', async () => {
      const result = await parser.parse(
        asFile(Buffer.from('﻿Fecha,Concepto\n10/03/2026,Venta\n'), CSV),
        undefined,
      );
      expect(result.headers[0]).toBe('Fecha');
    });

    it('leaves the amounts as text for the caller to read in its declared convention', async () => {
      const result = await parser.parse(
        asFile(Buffer.from('Concepto,Debe\nVenta,"58.750,00"\n'), CSV),
        undefined,
      );
      // Not 58.75, and not 58750: the parser does not decide, `parseDecimal` does.
      expect(result.data[0]['Debe']).toBe('58.750,00');
    });

    /**
     * A comma-decimal file written with comma delimiters and no quoting.
     *
     * `58.750,00` is cut into `58.750` and a stray `00`, and papaparse reports it as a field
     * mismatch. Tolerating that — as every `FieldMismatch` used to be — imported an amount a
     * thousand times too small, silently.
     */
    it('refuses a row whose delimiter cut through a value', async () => {
      await expect(
        parser.parse(asFile(Buffer.from('Concepto,Debe\nVenta,58.750,00\n'), CSV), undefined),
      ).rejects.toMatchObject({ messageKey: 'JOURNAL_ENTRIES.ARCHIVO_CSV_MAL_FORMADO' });
    });

    it('tolerates a short trailing row, whose missing columns simply read as empty', async () => {
      const result = await parser.parse(
        asFile(Buffer.from('Concepto,Debe,Haber\nVenta,100\n'), CSV),
        undefined,
      );
      expect(result.data[0]['Concepto']).toBe('Venta');
      expect(result.data[0]['Debe']).toBe('100');
    });

    it('refuses a file it cannot read rather than returning half of it', async () => {
      await expect(
        parser.parse(asFile(Buffer.from('Fecha,Concepto\n"sin cerrar,Venta\n'), CSV), undefined),
      ).rejects.toMatchObject({ messageKey: 'JOURNAL_ENTRIES.ARCHIVO_CSV_MAL_FORMADO' });
    });
  });

  describe('Excel', () => {
    it('reads the header row and every row under it', async () => {
      const file = await workbook([
        ['Asiento', 'Fecha', 'Cuenta', 'Debe'],
        ['A1', '10/03/2026', '1102', '58.750,00'],
        ['A1', '10/03/2026', '4100', ''],
      ]);

      const result = await parser.parse(asFile(file, XLSX_MIME), undefined);
      expect(result.headers).toEqual(['Asiento', 'Fecha', 'Cuenta', 'Debe']);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        Asiento: 'A1',
        Fecha: '10/03/2026',
        Cuenta: '1102',
        Debe: '58.750,00',
      });
    });

    /**
     * The defect `sheet_to_json` came with: it omits empty cells, so a column whose first data row
     * is blank disappeared from `Object.keys(data[0])` entirely.
     */
    it('keeps a column whose first data row is blank', async () => {
      const file = await workbook([
        ['Asiento', 'Debe', 'Haber'],
        ['A1', '100', null],
        ['A1', null, '100'],
      ]);

      const result = await parser.parse(asFile(file, XLSX_MIME), undefined);
      expect(result.headers).toEqual(['Asiento', 'Debe', 'Haber']);
      expect(result.data[0]['Haber']).toBe('');
      expect(result.data[1]['Haber']).toBe('100');
    });

    it('reads a numeric cell as the text it shows, without deciding what it means', async () => {
      const file = await workbook([
        ['Asiento', 'Debe'],
        ['A1', 58750.5],
      ]);

      const result = await parser.parse(asFile(file, XLSX_MIME), undefined);
      expect(result.data[0]['Debe']).toBe('58750.5');
    });

    /**
     * A date cell has no zone. Reading it in the server's — which is UTC in every deployment —
     * would move it by a day for a workbook written anywhere east or west of Greenwich.
     */
    it('reads a date cell as its calendar day', async () => {
      const file = await workbook([
        ['Asiento', 'Fecha'],
        ['A1', new Date(Date.UTC(2026, 2, 10))],
      ]);

      const result = await parser.parse(asFile(file, XLSX_MIME), undefined);
      expect(result.data[0]['Fecha']).toBe('2026-03-10');
    });

    it('skips a wholly empty row rather than importing it as an entry', async () => {
      const file = await workbook([
        ['Asiento', 'Debe'],
        ['A1', '100'],
        [null, null],
        ['A2', '200'],
      ]);

      const result = await parser.parse(asFile(file, XLSX_MIME), undefined);
      expect(result.data.map((row) => row['Asiento'])).toEqual(['A1', 'A2']);
    });

    it('refuses a file that is not a workbook', async () => {
      await expect(
        parser.parse(asFile(Buffer.from('no soy un libro de Excel'), XLSX_MIME), undefined),
      ).rejects.toMatchObject({ messageKey: 'JOURNAL_ENTRIES.ARCHIVO_EXCEL_MAL_FORMADO' });
    });
  });

  it('refuses a type it does not read', async () => {
    await expect(
      parser.parse(asFile(Buffer.from('%PDF-1.7'), 'application/pdf'), undefined),
    ).rejects.toMatchObject({ messageKey: 'JOURNAL_ENTRIES.TIPO_ARCHIVO_NO_SOPORTADO' });
  });

  it('says so when the upload carried no bytes', async () => {
    await expect(
      parser.parse({ mimetype: CSV } as FastifyFile, undefined),
    ).rejects.toMatchObject({
      messageKey: 'JOURNAL_ENTRIES.ARCHIVO_SUBIDO_ESTA_VACIO_NO_PUDO_LEER',
    });
  });
});
