import { ObjectLiteral, Repository } from 'typeorm';
import { DominicanRepublicReports } from './dr-reports';
import {
  Invoice,
  InvoiceStatus,
  InvoiceType,
  PaymentMethod,
} from '../../invoices/entities/invoice.entity';
import { PurchaseFiscalDocument } from '../../contracts/fiscal-records/purchase-fiscal-records.contract';
import { Organization } from '../../organizations/entities/organization.entity';

/**
 * The DGII's periodic returns.
 *
 * The previous implementation emitted six pipe-delimited fields for the 607 and five for the 606,
 * with no header line, against published formats of twenty-four and twenty-three. What it produced
 * could not be uploaded at all — and it reported annulled comprobantes as sales, and derived the
 * tax on a purchase by dividing an inclusive total by 1.18.
 */
/** What a call threw, to match its key and parameters. */
function thrown(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('DGII periodic reports', () => {
  const organization = {
    id: 'org-1',
    taxId: '131-19031-7',
    country: 'DO',
    fiscalProfile: { tipoIngreso: '01' },
  } as unknown as Organization;

  const invoice = (overrides: Partial<Invoice> = {}): Invoice =>
    ({
      id: 'inv-1',
      organizationId: 'org-1',
      invoiceNumber: 'FAC-00000001',
      fiscalNumber: 'E310000000001',
      customerTaxId: '101234563',
      issueDate: '2026-08-15',
      status: InvoiceStatus.PENDING,
      type: InvoiceType.INVOICE,
      paymentMethod: PaymentMethod.CASH,
      subtotal: 1000,
      discountTotal: 0,
      taxedTotal: 1000,
      exemptTotal: 0,
      goodsTotal: 700,
      servicesTotal: 300,
      tax: 180,
      serviceCharge: 0,
      taxWithheld: 0,
      incomeTaxWithheld: 0,
      total: 1180,
      lineItems: [],
      ...overrides,
    }) as Invoice;

  const repositoryOf = <T extends ObjectLiteral>(rows: T[]): Repository<T> =>
    ({
      find: jest.fn().mockResolvedValue(rows),
      createQueryBuilder: jest.fn(() => ({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(rows),
      })),
    }) as unknown as Repository<T>;

  describe('607 — ventas', () => {
    it('emits a header and the full column set', async () => {
      const body = await DominicanRepublicReports.generate607Report(
        'org-1', 2026, 8, repositoryOf([invoice()]), organization,
      );
      const [header, row] = body.split('\n');

      expect(header).toBe('607|131190317|202608|1|1000.00');
      // Twenty-four positional columns, whatever their value.
      expect(row.split('|')).toHaveLength(24);
    });

    it('reports the buyer, the comprobante and the amounts in their columns', async () => {
      const body = await DominicanRepublicReports.generate607Report(
        'org-1', 2026, 8, repositoryOf([invoice()]), organization,
      );
      const columns = body.split('\n')[1].split('|');

      expect(columns[0]).toBe('101234563');
      expect(columns[1]).toBe('1'); // RNC
      expect(columns[2]).toBe('E310000000001');
      expect(columns[4]).toBe('01'); // tipo de ingreso
      expect(columns[5]).toBe('20260815');
      expect(columns[6]).toBe('300.00'); // servicios
      expect(columns[7]).toBe('700.00'); // bienes
      expect(columns[9]).toBe('180.00'); // ITBIS
    });

    it('classifies an eleven-digit identifier as a cédula', async () => {
      const body = await DominicanRepublicReports.generate607Report(
        'org-1', 2026, 8, repositoryOf([invoice({ customerTaxId: '00112345678' })]), organization,
      );
      expect(body.split('\n')[1].split('|')[1]).toBe('2');
    });

    it('places the amount in the column of the payment method used', async () => {
      const body = await DominicanRepublicReports.generate607Report(
        'org-1', 2026, 8,
        repositoryOf([invoice({ paymentMethod: PaymentMethod.CREDIT })]),
        organization,
      );
      const columns = body.split('\n')[1].split('|');
      expect(columns[17]).toBe('0.00'); // efectivo
      expect(columns[20]).toBe('1180.00'); // venta a crédito
    });

    it('reports the legal service charge in its own column', async () => {
      const body = await DominicanRepublicReports.generate607Report(
        'org-1', 2026, 8, repositoryOf([invoice({ serviceCharge: 100 })]), organization,
      );
      expect(body.split('\n')[1].split('|')[16]).toBe('100.00');
    });

    it('counts no records when the period is empty', async () => {
      const body = await DominicanRepublicReports.generate607Report(
        'org-1', 2026, 8, repositoryOf<Invoice>([]), organization,
      );
      expect(body).toBe('607|131190317|202608|0|0.00');
    });
  });

  describe('606 — compras', () => {
    const document = (overrides: Partial<PurchaseFiscalDocument> = {}): PurchaseFiscalDocument => ({
      kind: 'bill',
      reference: 'B0100000001',
      supplierName: 'Suplidor SRL',
      supplierTaxId: '130862346',
      supplierCountry: 'DO',
      fiscalNumber: 'B0100000001',
      modifiedFiscalNumber: null,
      date: '2026-08-10',
      paidOn: null,
      purchaseCategory: '06',
      paymentForm: '01',
      servicesAmount: 0,
      goodsAmount: 1000,
      taxAmount: 180,
      taxWithheld: 0,
      taxProportional: 0,
      taxToCost: 0,
      incomeTaxWithheld: 0,
      isrRetentionType: null,
      exciseAmount: 0,
      otherTaxes: 0,
      serviceCharge: 0,
      total: 1180,
      ...overrides,
    });

    const creditNote = (overrides: Partial<PurchaseFiscalDocument> = {}): PurchaseFiscalDocument =>
      document({
        kind: 'credit_note',
        reference: 'ND-2026-000001',
        fiscalNumber: 'B0400000007',
        modifiedFiscalNumber: 'B0100000001',
        date: '2026-08-12',
        paymentForm: '06',
        servicesAmount: 50,
        goodsAmount: 150,
        taxAmount: 36,
        total: 236,
        ...overrides,
      });

    it('emits a header and the full column set', () => {
      const body = DominicanRepublicReports.generate606Report(2026, 8, [document()], organization);
      const [header, row] = body.split('\n');
      expect(header).toBe('606|131190317|202608|1');
      expect(row.split('|')).toHaveLength(23);
    });

    it('reports the tax actually borne, not one reverse-engineered from the total', () => {
      // An exempt purchase: the old report derived 18 % from the inclusive total regardless.
      const body = DominicanRepublicReports.generate606Report(
        2026, 8, [document({ goodsAmount: 1000, taxAmount: 0, total: 1000 })], organization,
      );
      expect(body.split('\n')[1].split('|')[10]).toBe('0.00');
    });

    it('carries the withholding and the deductible remainder', () => {
      const body = DominicanRepublicReports.generate606Report(
        2026, 8,
        [document({ taxWithheld: 54, taxToCost: 20, incomeTaxWithheld: 100, isrRetentionType: '02' })],
        organization,
      );
      const columns = body.split('\n')[1].split('|');
      expect(columns[11]).toBe('54.00'); // ITBIS retenido
      expect(columns[13]).toBe('20.00'); // ITBIS llevado al costo
      expect(columns[14]).toBe('160.00'); // ITBIS por adelantar: 180 − 0 − 20
      expect(columns[16]).toBe('02'); // tipo de retención en ISR
      expect(columns[17]).toBe('100.00');
    });

    it('refuses to produce a file the DGII would reject, naming the documents without a supplier id (QA B-02)', () => {
      expect(
        thrown(() =>
          DominicanRepublicReports.generate606Report(
            2026, 8,
            [
              document(),
              document({ fiscalNumber: 'B0100000002', supplierTaxId: null, supplierName: 'Sin RNC SRL' }),
              document({ fiscalNumber: 'B0100000003', supplierTaxId: '130862347', supplierName: 'Dígito malo SRL' }),
            ],
            organization,
          ),
        ),
      ).toMatchObject({
        messageKey: 'compliance.report_606_supplier_tax_id_missing',
        params: { count: 2, bills: 'B0100000002 (Sin RNC SRL), B0100000003 (Dígito malo SRL)' },
      });
    });

    describe('supplier credit notes', () => {
      it('reports the note as its own record, paired with the bill it modifies', () => {
        const body = DominicanRepublicReports.generate606Report(2026, 8, [document(), creditNote()], organization);
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

      it('refuses a note whose bill carries no NCF, naming it', () => {
        expect(
          thrown(() =>
            DominicanRepublicReports.generate606Report(2026, 8, [creditNote({ modifiedFiscalNumber: null })], organization),
          ),
        ).toMatchObject({
          messageKey: 'compliance.report_606_credit_note_without_modified_ncf',
          params: { count: 1, notes: 'ND-2026-000001 (B0400000007)' },
        });
      });
    });
  });

  describe('608 — comprobantes anulados', () => {
    it('reports each number of a range declared unused, with its annulment code', () => {
      const body = DominicanRepublicReports.generate608Report(
        2026, 8,
        DominicanRepublicReports.expandRange('31', 41, 42).map((ncf) => ({ ncf, date: '2026-08-15', code: '08' })),
        organization,
      );
      const [header, ...rows] = body.split('\n');
      expect(header).toBe('608|131190317|202608|2');
      expect(rows).toEqual(['E310000000041|20260815|08', 'E310000000042|20260815|08']);
    });

    it('a comprobante cancelled by a credit note is not an annulled number: it stays in the 607', async () => {
      const body = await DominicanRepublicReports.generate607Report(
        'org-1', 2026, 8,
        repositoryOf([invoice({ status: InvoiceStatus.VOID, voidReason: 'Anulada por nota de crédito total' })]),
        organization,
      );
      expect(body.split('\n')[0]).toBe('607|131190317|202608|1|1000.00');
    });
  });

  describe('609 — pagos al exterior', () => {
    it('reports a non-resident supplier with the tax withheld', () => {
      const foreign: PurchaseFiscalDocument = {
        kind: 'bill', reference: 'bill-2', supplierName: 'Global Services LLC', supplierTaxId: '12-3456789',
        supplierCountry: 'US', fiscalNumber: null, modifiedFiscalNumber: null, date: '2026-08-20', paidOn: null,
        purchaseCategory: null, paymentForm: null, servicesAmount: 5000, goodsAmount: 0, taxAmount: 0,
        taxWithheld: 0, taxProportional: 0, taxToCost: 0, incomeTaxWithheld: 1350, isrRetentionType: null,
        exciseAmount: 0, otherTaxes: 0, serviceCharge: 0, total: 5000,
      };

      const body = DominicanRepublicReports.generate609Report(2026, 8, [foreign], organization);
      const [header, row] = body.split('\n');
      expect(header).toBe('609|131190317|202608|1');
      expect(row).toBe('Global Services LLC|02|20260820|5000.00|1350.00');
    });
  });
});
