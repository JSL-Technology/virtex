import { Repository } from 'typeorm';
import { PurchaseFiscalRecordsProvider, splitLikeBill } from './purchase-fiscal-records.provider';
import { PurchaseFiscalRecordsRegistry } from '../contracts/fiscal-records/purchase-fiscal-records.registry';
import { VendorBill, VendorBillStatus } from './entities/vendor-bill.entity';
import { VendorDebitNote, VendorDebitNoteStatus } from './entities/vendor-debit-note.entity';

/**
 * What Purchasing tells the purchases return: its bills and the supplier credit notes against them.
 */
describe('PurchaseFiscalRecordsProvider', () => {
  const bill = (overrides: Partial<VendorBill> = {}): VendorBill =>
    ({
      id: 'bill-1',
      organizationId: 'org-1',
      ncf: 'B0100000001',
      date: '2026-08-10',
      status: VendorBillStatus.OPEN,
      vendor: { taxId: '130862346', name: 'Suplidor SRL', country: 'DO' },
      servicesAmount: 250,
      goodsAmount: 750,
      taxAmount: 180,
      taxWithheld: 0,
      incomeTaxWithheld: 0,
      taxToCost: 0,
      taxProportional: 0,
      exciseAmount: 0,
      otherTaxes: 0,
      serviceCharge: 0,
      purchaseCategory: '02',
      paymentForm: '04',
      total: 1180,
      ...overrides,
    }) as unknown as VendorBill;

  const note = (overrides: Partial<VendorDebitNote> = {}): VendorDebitNote =>
    ({
      id: 'note-1',
      organizationId: 'org-1',
      number: 'ND-2026-000001',
      ncf: 'B0400000007',
      date: '2026-08-10',
      status: VendorDebitNoteStatus.POSTED,
      amount: 236,
      taxAmount: 36,
      vendorBill: bill(),
      ...overrides,
    }) as unknown as VendorDebitNote;

  function provider(bills: VendorBill[], notes: VendorDebitNote[]) {
    const registry = new PurchaseFiscalRecordsRegistry();
    const instance = new PurchaseFiscalRecordsProvider(
      { find: jest.fn().mockResolvedValue(bills) } as unknown as Repository<VendorBill>,
      { find: jest.fn().mockResolvedValue(notes) } as unknown as Repository<VendorDebitNote>,
      registry,
    );
    instance.onModuleInit();
    return { instance, registry };
  }

  it('registers itself as the source of purchase records', () => {
    const { instance, registry } = provider([], []);
    expect(registry.source()).toBe(instance);
  });

  it('reports a credit note with its bill as the comprobante it modifies, split like the bill', async () => {
    const { instance } = provider([bill()], [note()]);
    const [billRecord, noteRecord] = await instance.fiscalDocuments({ organizationId: 'org-1', from: '2026-08-01', to: '2026-08-31' });

    expect(billRecord).toMatchObject({ kind: 'bill', fiscalNumber: 'B0100000001', paymentForm: '04' });
    expect(noteRecord).toMatchObject({
      kind: 'credit_note',
      reference: 'ND-2026-000001',
      fiscalNumber: 'B0400000007',
      modifiedFiscalNumber: 'B0100000001',
      supplierTaxId: '130862346',
      purchaseCategory: '02',
      paymentForm: '06',
      // 200 before tax, 25 / 75 the way the bill was split.
      servicesAmount: 50,
      goodsAmount: 150,
      taxAmount: 36,
      total: 236,
    });
  });

  it('keeps one chronology: a note after the bills of its day, before the later bills', async () => {
    const { instance } = provider(
      [bill(), bill({ id: 'bill-2', ncf: 'B0100000002', date: '2026-08-20' })],
      [note({ date: '2026-08-10' })],
    );
    const documents = await instance.fiscalDocuments({ organizationId: 'org-1', from: '2026-08-01', to: '2026-08-31' });
    expect(documents.map((document) => document.fiscalNumber)).toEqual(['B0100000001', 'B0400000007', 'B0100000002']);
  });

  it('puts the whole amount under goods when the bill recorded no split, without losing a cent', () => {
    expect(splitLikeBill({ amount: 100.01, taxAmount: 0 }, { servicesAmount: 0, goodsAmount: 0 })).toEqual({
      services: 0,
      goods: 100.01,
    });
    // A third each way: the goods take the rounding remainder.
    expect(splitLikeBill({ amount: 100, taxAmount: 0 }, { servicesAmount: 1, goodsAmount: 2 })).toEqual({
      services: 33.33,
      goods: 66.67,
    });
  });

  it('refuses a second, different source rather than answering a return twice', () => {
    const { registry } = provider([], []);
    expect(() => registry.register({ sourceName: 'other' } as never)).toThrow(/already answered/);
  });

  it('says plainly when nothing answers for purchases', () => {
    expect(() => new PurchaseFiscalRecordsRegistry().source()).toThrow();
  });
});
