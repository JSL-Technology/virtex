import type {
  MarketReturnFiling,
  MarketReturnResult,
  ReturnDataset,
  ReturnEmployeeEventRecord,
  ReturnPayslipRecord,
  ReturnPurchaseRecord,
  ReturnSalesRecord,
} from '../../contracts';
import { FORMAT_607_BOXES, annulled608, foreign609, novedades, purchases606, sales607, suir } from './index';

/**
 * The DGII's periodic returns, built from the period's facts.
 *
 * The first implementation emitted six pipe-delimited fields for the 607 and five for the 606, with
 * no header line, against published formats of twenty-three boxes each: what it produced could not
 * be uploaded at all. It also reported annulled comprobantes as sales and derived the tax on a
 * purchase by dividing an inclusive total by 1.18.
 *
 * The expected records below are written from the published layouts (Norma General 07-2018), box by
 * box, independently of the generator — a test written from the code agrees with the code.
 */
describe('DGII periodic returns', () => {
  const dataset = (
    parts: {
      sales?: readonly ReturnSalesRecord[];
      purchases?: readonly ReturnPurchaseRecord[];
      foreign?: readonly ReturnPurchaseRecord[];
      payslips?: readonly ReturnPayslipRecord[];
      events?: readonly ReturnEmployeeEventRecord[];
      fiscalProfile?: Record<string, string>;
    } = {},
  ): ReturnDataset => ({
    filer: {
      taxId: '131-19031-7',
      legalName: 'Mi Empresa SRL',
      country: 'DO',
      fiscalProfile: parts.fiscalProfile ?? { tipoIngreso: '01' },
    },
    period: { year: 2026, month: 8, from: '2026-08-01', to: '2026-08-31' },
    sales: async () => parts.sales ?? [],
    purchases: async () => parts.purchases ?? [],
    foreignPurchases: async () => parts.foreign ?? [],
    accounts: async () => [],
    journals: async () => [],
    payslips: async () => parts.payslips ?? [],
    employeeEvents: async () => parts.events ?? [],
  });

  const sale = (overrides: Partial<ReturnSalesRecord> = {}): ReturnSalesRecord => ({
    fiscalNumber: 'E310000000001',
    documentType: 'E31',
    issueDate: '2026-08-15',
    counterpartyTaxId: '101234563',
    counterpartyName: 'Cliente SRL',
    modifiedFiscalNumber: null,
    netAmount: 1000,
    taxAmount: 180,
    exciseAmount: 0,
    otherTaxes: 0,
    serviceCharge: 0,
    total: 1180,
    taxWithheld: 0,
    incomeTaxWithheld: 0,
    withheldOn: null,
    settlement: { cash: 1180, transfer: 0, card: 0, credit: 0, giftCard: 0, swap: 0, other: 0 },
    annulled: false,
    annulmentCode: null,
    annulmentReason: null,
    origin: 'DOCUMENT',
    ...overrides,
  });

  const purchase = (overrides: Partial<ReturnPurchaseRecord> = {}): ReturnPurchaseRecord => ({
    kind: 'bill',
    reference: 'B0100000001',
    supplierName: 'Suplidor SRL',
    supplierTaxId: '130862346',
    supplierCountry: 'DO',
    fiscalNumber: 'B0100000001',
    modifiedFiscalNumber: null,
    date: '2026-08-10',
    paidOn: null,
    fiscalAttributes: { purchaseCategory: '06' },
    paymentFiscalCode: '01',
    servicesAmount: 0,
    goodsAmount: 1000,
    taxAmount: 180,
    taxWithheld: 0,
    taxProportional: 0,
    taxToCost: 0,
    incomeTaxWithheld: 0,
    exciseAmount: 0,
    otherTaxes: 0,
    serviceCharge: 0,
    total: 1180,
    ...overrides,
  });

  const creditNote = (overrides: Partial<ReturnPurchaseRecord> = {}): ReturnPurchaseRecord =>
    purchase({
      kind: 'credit_note',
      reference: 'ND-2026-000001',
      fiscalNumber: 'B0400000007',
      modifiedFiscalNumber: 'B0100000001',
      date: '2026-08-12',
      // The 606 codes a credit note's «forma de pago» itself; the note carries none.
      paymentFiscalCode: null,
      servicesAmount: 50,
      goodsAmount: 150,
      taxAmount: 36,
      total: 236,
      ...overrides,
    });

  /** The file, or a failure naming the refusal that came back instead. */
  const fileOf = async (filing: MarketReturnFiling, data: ReturnDataset, options = {}): Promise<string> => {
    const result: MarketReturnResult = await filing.build(data, options);
    if (!result.file) throw new Error(`refused: ${result.refusal?.messageKey}`);
    return result.file;
  };

  describe('607 — ventas', () => {
    it('has the twenty-three boxes of the published format, in order', () => {
      expect(FORMAT_607_BOXES).toHaveLength(23);
      expect(FORMAT_607_BOXES[6]).toBe('Fecha de Retención');
      expect(FORMAT_607_BOXES[7]).toBe('Monto Facturado');
      expect(FORMAT_607_BOXES.slice(16)).toEqual([
        'Efectivo',
        'Cheque/Transferencia/Depósito',
        'Tarjeta Débito/Crédito',
        'Venta a Crédito',
        'Bonos o Certificados de Regalo',
        'Permuta',
        'Otras Formas de Ventas',
      ]);
    });

    it('writes the header and a cash sale exactly as the format lays them out', async () => {
      const body = await fileOf(sales607, dataset({ sales: [sale()] }));
      const [header, row] = body.split('\n');

      // 607 | RNC | período | cantidad de registros
      expect(header).toBe('607|131190317|202608|1');
      //           1         2 3             4 5  6        7 8       9      10   11   12   13   14   15   16   17      18   19   20   21   22   23
      expect(row).toBe('101234563|1|E310000000001||01|20260815||1000.00|180.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|1180.00|0.00|0.00|0.00|0.00|0.00|0.00');
    });

    it('reports what the customer withheld, and when, from the receipts that carried it', async () => {
      const body = await fileOf(
        sales607,
        dataset({
          sales: [
            sale({
              taxWithheld: 54,
              incomeTaxWithheld: 100,
              withheldOn: '2026-09-10',
              settlement: { cash: 0, transfer: 0, card: 0, credit: 1180, giftCard: 0, swap: 0, other: 0 },
            }),
          ],
        }),
      );
      const boxes = body.split('\n')[1].split('|');
      expect(boxes[6]).toBe('20260910'); // 7 — Fecha de Retención
      expect(boxes[9]).toBe('54.00'); // 10 — ITBIS retenido por terceros
      expect(boxes[11]).toBe('100.00'); // 12 — Retención renta por terceros
      expect(boxes[19]).toBe('1180.00'); // 20 — Venta a crédito
    });

    it('leaves the withholding date empty when nothing was withheld', async () => {
      // Expected at issuance is not withheld: until a receipt carries it, boxes 7, 10 and 12 are empty.
      const body = await fileOf(sales607, dataset({ sales: [sale()] }));
      const boxes = body.split('\n')[1].split('|');
      expect(boxes[6]).toBe('');
      expect(boxes[9]).toBe('0.00');
    });

    it('classifies an eleven-digit identifier as a cédula', async () => {
      const body = await fileOf(sales607, dataset({ sales: [sale({ counterpartyTaxId: '00112345678' })] }));
      expect(body.split('\n')[1].split('|')[1]).toBe('2');
    });

    it('reports the legal service charge in box 16', async () => {
      const body = await fileOf(sales607, dataset({ sales: [sale({ serviceCharge: 100 })] }));
      expect(body.split('\n')[1].split('|')[15]).toBe('100.00');
    });

    it('writes a till ticket with the same twenty-three boxes', async () => {
      const ticket = sale({
        fiscalNumber: 'B0200000001',
        documentType: 'B02',
        issueDate: '2026-08-02',
        counterpartyTaxId: null,
        counterpartyName: null,
        netAmount: 100,
        taxAmount: 18,
        total: 118,
        settlement: { cash: 118, transfer: 0, card: 0, credit: 0, giftCard: 0, swap: 0, other: 0 },
        origin: 'TILL',
      });
      const body = await fileOf(sales607, dataset({ sales: [ticket] }));
      expect(body.split('\n')[1]).toBe('||B0200000001||01|20260802||100.00|18.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|118.00|0.00|0.00|0.00|0.00|0.00|0.00');
    });

    it('leaves an annulled comprobante to the 608', async () => {
      const body = await fileOf(
        sales607,
        dataset({ sales: [sale(), sale({ fiscalNumber: 'E310000000002', annulled: true })] }),
      );
      expect(body.split('\n')).toHaveLength(2);
      expect(body).toContain('607|131190317|202608|1');
      expect(body).not.toContain('E310000000002');
    });

    it('counts no records when the period is empty', async () => {
      expect(await fileOf(sales607, dataset())).toBe('607|131190317|202608|0');
    });
  });

  describe('606 — compras', () => {
    it('emits a header and the full column set', async () => {
      const body = await fileOf(purchases606, dataset({ purchases: [purchase()] }));
      const [header, row] = body.split('\n');
      expect(header).toBe('606|131190317|202608|1');
      expect(row.split('|')).toHaveLength(23);
    });

    it('reports the tax actually borne, not one reverse-engineered from the total', async () => {
      // An exempt purchase: the old report derived 18 % from the inclusive total regardless.
      const body = await fileOf(
        purchases606,
        dataset({ purchases: [purchase({ goodsAmount: 1000, taxAmount: 0, total: 1000 })] }),
      );
      expect(body.split('\n')[1].split('|')[10]).toBe('0.00');
    });

    it('carries the withholding and the deductible remainder', async () => {
      const body = await fileOf(
        purchases606,
        dataset({
          purchases: [
            purchase({
              taxWithheld: 54,
              taxToCost: 20,
              incomeTaxWithheld: 100,
              fiscalAttributes: { purchaseCategory: '06', isrRetentionType: '02' },
            }),
          ],
        }),
      );
      const columns = body.split('\n')[1].split('|');
      expect(columns[11]).toBe('54.00'); // ITBIS retenido
      expect(columns[13]).toBe('20.00'); // ITBIS llevado al costo
      expect(columns[14]).toBe('160.00'); // ITBIS por adelantar: 180 − 0 − 20
      expect(columns[16]).toBe('02'); // tipo de retención en ISR
      expect(columns[17]).toBe('100.00');
    });

    it('refuses to produce a file the DGII would reject, naming the documents without a supplier id (QA B-02)', async () => {
      const result = await purchases606.build(
        dataset({
          purchases: [
            purchase(),
            purchase({ fiscalNumber: 'B0100000002', supplierTaxId: null, supplierName: 'Sin RNC SRL' }),
            purchase({ fiscalNumber: 'B0100000003', supplierTaxId: '130862347', supplierName: 'Dígito malo SRL' }),
          ],
        }),
        {},
      );
      expect(result.refusal).toMatchObject({
        messageKey: 'compliance.report_606_supplier_tax_id_missing',
        params: { count: 2, bills: 'B0100000002 (Sin RNC SRL), B0100000003 (Dígito malo SRL)' },
      });
      expect(result.file).toBeUndefined();
    });

    it('refuses a purchase nobody classified rather than filing a category it never stated', async () => {
      const result = await purchases606.build(
        dataset({ purchases: [purchase({ fiscalAttributes: {} })] }),
        {},
      );
      expect(result.refusal).toMatchObject({ messageKey: 'compliance.report_606_purchase_not_classified' });
    });

    describe('supplier credit notes', () => {
      it('reports the note as its own record, paired with the bill it modifies', async () => {
        const body = await fileOf(purchases606, dataset({ purchases: [purchase(), creditNote()] }));
        const [header, , noteRow] = body.split('\n');
        expect(header).toBe('606|131190317|202608|2');

        const columns = noteRow.split('|');
        expect(columns).toHaveLength(23);
        expect(columns[0]).toBe('130862346');
        expect(columns[3]).toBe('B0400000007'); // the note's own NCF
        expect(columns[4]).toBe('B0100000001'); // NCF modificado: the bill's
        expect(columns[5]).toBe('20260812');
        expect(columns[6]).toBe(''); // no payment date: it was not paid, it reduced a debt
        expect(columns[9]).toBe('200.00');
        expect(columns[10]).toBe('36.00');
        expect(columns[14]).toBe('36.00'); // the ITBIS credit it gives back
        expect(columns[22]).toBe('06'); // forma de pago: nota de crédito
      });

      it('refuses a note whose bill carries no NCF, naming it', async () => {
        const result = await purchases606.build(
          dataset({ purchases: [creditNote({ modifiedFiscalNumber: null })] }),
          {},
        );
        expect(result.refusal).toMatchObject({
          messageKey: 'compliance.report_606_credit_note_without_modified_ncf',
          params: { count: 1, notes: 'ND-2026-000001 (B0400000007)' },
        });
      });
    });
  });

  describe('608 — comprobantes anulados', () => {
    it('reports an annulled comprobante with the code recorded when it was voided', async () => {
      const body = await fileOf(
        annulled608,
        dataset({ sales: [sale({ annulled: true, annulmentCode: '02', annulmentReason: 'Error de impresión' })] }),
      );
      const [header, row] = body.split('\n');
      expect(header).toBe('608|131190317|202608|1');
      expect(row).toBe('E310000000001|20260815|02');
    });

    it('derives the code from the words only for a document voided before one was recorded', async () => {
      const body = await fileOf(
        annulled608,
        dataset({ sales: [sale({ annulled: true, annulmentReason: 'Duplicado por error' })] }),
      );
      expect(body.split('\n')[1]).toBe('E310000000001|20260815|03');
    });

    it('reports nothing for a comprobante a credit note reversed', async () => {
      // It stays a sale of its period (607) and its note is the record of the reversal.
      expect(await fileOf(annulled608, dataset({ sales: [sale()] }))).toBe('608|131190317|202608|0');
    });
  });

  describe('609 — pagos al exterior', () => {
    it('reports a non-resident supplier with the tax withheld', async () => {
      const foreign = purchase({
        reference: 'bill-2',
        supplierName: 'Global Services LLC',
        supplierTaxId: '12-3456789',
        supplierCountry: 'US',
        fiscalNumber: null,
        date: '2026-08-20',
        fiscalAttributes: {},
        paymentFiscalCode: null,
        servicesAmount: 5000,
        goodsAmount: 0,
        taxAmount: 0,
        incomeTaxWithheld: 1350,
        total: 5000,
      });

      const body = await fileOf(foreign609, dataset({ foreign: [foreign] }));
      const [header, row] = body.split('\n');
      expect(header).toBe('609|131190317|202608|1');
      expect(row).toBe('Global Services LLC|02|20260820|5000.00|1350.00');
    });
  });

  /**
   * What the Tesorería de la Seguridad Social is told about the month's payroll.
   *
   * These were a service of the payroll module with their own HTTP routes, so a Dominican filing
   * lived in payroll and the module knew the names of four funds.
   */
  describe('TSS — seguridad social', () => {
    const payslip = (overrides: Partial<ReturnPayslipRecord> = {}): ReturnPayslipRecord => ({
      employeeName: 'Ana Pérez',
      socialSecurityNumber: '12345678901',
      contributoryBase: 50_000,
      contributions: [
        { code: 'AFP', employeeAmount: 1437.5, employerAmount: 3914 },
        { code: 'SFS', employeeAmount: 1526.5, employerAmount: 3573.5 },
        { code: 'SRL', employeeAmount: 0, employerAmount: 605 },
        { code: 'INFOTEP', employeeAmount: 0, employerAmount: 500 },
      ],
      ...overrides,
    });

    it('declares what was paid, fund by fund, from the period’s approved payslips', async () => {
      const body = await fileOf(suir, dataset({ payslips: [payslip()] }));
      const [, period, count, columns, row] = body.split('\n');

      expect(period).toBe('# Periodo: 202608');
      expect(count).toBe('# Empleados: 1');
      expect(columns).toContain('NSS|Nombre|SalarioCotizable');
      // NSS, name, contributory base, then each fund's employee and employer share.
      expect(row).toBe('12345678901|Ana Pérez|50000.00|1437.50|3914.00|1526.50|3573.50|605.00|500.00');
    });

    it('sums a fund that appears twice, as an adjustment run leaves it', async () => {
      const body = await fileOf(
        suir,
        dataset({
          payslips: [
            payslip({
              contributions: [
                { code: 'AFP', employeeAmount: 1000, employerAmount: 2000 },
                { code: 'AFP', employeeAmount: 437.5, employerAmount: 1914 },
              ],
            }),
          ],
        }),
      );
      expect(body.split('\n')[4]).toContain('|1437.50|3914.00|');
    });

    it('refuses to declare a period nothing was approved for', async () => {
      // Declaring a calculation nobody was paid is the one thing this filing must never do.
      const result = await suir.build(dataset(), {});
      expect(result.refusal).toMatchObject({ messageKey: 'returns.do.tss_requires_approved_run' });
    });

    it('reports who joined, who left and whose salary changed, in the TSS’s own words', async () => {
      const body = await fileOf(
        novedades,
        dataset({
          events: [
            { kind: 'HIRE', employeeName: 'Ana Pérez', socialSecurityNumber: '1', effectiveDate: '2026-08-03', salary: null, currencyCode: null },
            { kind: 'SALARY_CHANGE', employeeName: 'Luis Gómez', socialSecurityNumber: '2', effectiveDate: '2026-08-15', salary: 60_000, currencyCode: 'DOP' },
            { kind: 'TERMINATION', employeeName: 'Sara Díaz', socialSecurityNumber: null, effectiveDate: '2026-08-28', salary: null, currencyCode: null },
          ],
        }),
      );
      const [, , count, , ...rows] = body.split('\n');

      expect(count).toBe('# Registros: 3');
      expect(rows[0]).toBe('ALTA|1|Ana Pérez|20260803|');
      expect(rows[1]).toBe('CAMBIO_SALARIO|2|Luis Gómez|20260815|60000.00');
      expect(rows[2]).toBe('BAJA||Sara Díaz|20260828|');
    });

    it('needs the right to read payroll, which reading a sales return is not', () => {
      expect(suir.permission).toBe('payroll:view');
      expect(novedades.permission).toBe('payroll:view');
      expect(sales607.permission).toBeUndefined();
    });
  });

  it('declares what each filing is, for the door that offers it', () => {
    expect([purchases606, sales607, annulled608, foreign609].map((filing) => filing.code)).toEqual(['606', '607', '608', '609']);
    for (const filing of [purchases606, sales607, annulled608, foreign609]) {
      expect(filing.periodicity).toBe('MONTHLY');
      expect(filing.tracked).toBe(true);
      expect(filing.mediaType).toContain('text/plain');
      expect(filing.fileName({ year: 2026, month: 8, from: '2026-08-01', to: '2026-08-31' })).toBe(`DGII_${filing.code}_202608.txt`);
    }
  });
});
