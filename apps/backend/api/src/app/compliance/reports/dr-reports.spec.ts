import { ObjectLiteral, Repository } from 'typeorm';
import { DominicanRepublicReports } from './dr-reports';
import {
  Invoice,
  InvoiceStatus,
  InvoiceType,
  PaymentMethod,
} from '../../invoices/entities/invoice.entity';
import { VendorBill, VendorBillStatus } from '../../accounts-payable/entities/vendor-bill.entity';
import { Organization } from '../../organizations/entities/organization.entity';

/**
 * The DGII's periodic returns.
 *
 * The previous implementation emitted six pipe-delimited fields for the 607 and five for the 606,
 * with no header line, against published formats of twenty-four and twenty-three. What it produced
 * could not be uploaded at all — and it reported annulled comprobantes as sales, and derived the
 * tax on a purchase by dividing an inclusive total by 1.18.
 */
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
      ncfNumber: 'E310000000001',
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
    const bill = (overrides: Partial<VendorBill> = {}): VendorBill =>
      ({
        id: 'bill-1',
        organizationId: 'org-1',
        ncf: 'B0100000001',
        date: new Date('2026-08-10T00:00:00Z'),
        status: VendorBillStatus.OPEN,
        vendor: { taxId: '130862346', name: 'Suplidor SRL' },
        servicesAmount: 0,
        goodsAmount: 1000,
        taxAmount: 180,
        taxWithheld: 0,
        incomeTaxWithheld: 0,
        taxToCost: 0,
        taxProportional: 0,
        exciseAmount: 0,
        otherTaxes: 0,
        serviceCharge: 0,
        purchaseCategory: '06',
        paymentForm: '01',
        total: 1180,
        ...overrides,
      }) as unknown as VendorBill;

    it('emits a header and the full column set', async () => {
      const body = await DominicanRepublicReports.generate606Report(
        'org-1', 2026, 8, repositoryOf([bill()]), organization,
      );
      const [header, row] = body.split('\n');
      expect(header).toBe('606|131190317|202608|1');
      expect(row.split('|')).toHaveLength(23);
    });

    it('reports the tax actually borne, not one reverse-engineered from the total', async () => {
      // An exempt purchase: the old report derived 18 % from the inclusive total regardless.
      const body = await DominicanRepublicReports.generate606Report(
        'org-1', 2026, 8,
        repositoryOf([bill({ goodsAmount: 1000, taxAmount: 0, total: 1000 })]),
        organization,
      );
      expect(body.split('\n')[1].split('|')[10]).toBe('0.00');
    });

    it('carries the withholding and the deductible remainder', async () => {
      const body = await DominicanRepublicReports.generate606Report(
        'org-1', 2026, 8,
        repositoryOf([bill({ taxWithheld: 54, taxToCost: 20, incomeTaxWithheld: 100, isrRetentionType: '02' })]),
        organization,
      );
      const columns = body.split('\n')[1].split('|');
      expect(columns[11]).toBe('54.00'); // ITBIS retenido
      expect(columns[13]).toBe('20.00'); // ITBIS llevado al costo
      expect(columns[14]).toBe('160.00'); // ITBIS por adelantar: 180 − 0 − 20
      expect(columns[16]).toBe('02'); // tipo de retención en ISR
      expect(columns[17]).toBe('100.00');
    });
  });

  describe('608 — comprobantes anulados', () => {
    it('reports an annulled comprobante with its annulment code', async () => {
      const body = await DominicanRepublicReports.generate608Report(
        'org-1', 2026, 8,
        repositoryOf([invoice({ status: InvoiceStatus.VOID, voidReason: 'Duplicado por error' })]),
        organization,
      );
      const [header, row] = body.split('\n');
      expect(header).toBe('608|131190317|202608|1');
      expect(row).toBe('E310000000001|20260815|03');
    });
  });

  describe('609 — pagos al exterior', () => {
    it('reports a non-resident supplier with the tax withheld', async () => {
      const foreign = {
        id: 'bill-2', organizationId: 'org-1', ncf: null,
        date: new Date('2026-08-20T00:00:00Z'), status: VendorBillStatus.OPEN,
        vendor: { name: 'Global Services LLC', country: 'US', taxId: '12-3456789' },
        servicesAmount: 5000, goodsAmount: 0, incomeTaxWithheld: 1350, total: 5000,
      } as unknown as VendorBill;

      const body = await DominicanRepublicReports.generate609Report(
        'org-1', 2026, 8, repositoryOf([foreign]), organization,
      );
      const [header, row] = body.split('\n');
      expect(header).toBe('609|131190317|202608|1');
      expect(row).toBe('Global Services LLC|02|20260820|5000.00|1350.00');
    });
  });
});
