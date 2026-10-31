import { buildIr17, buildIt1, worksheetCsv } from './dr-declarations';
import type { PurchaseFiscalDocument } from '../../contracts/fiscal-records/purchase-fiscal-records.contract';

const purchase = (over: Partial<PurchaseFiscalDocument> = {}): PurchaseFiscalDocument => ({
  kind: 'bill', reference: 'B', supplierName: 'S', supplierTaxId: '131000001', supplierCountry: 'DO',
  fiscalNumber: 'E310000000001', modifiedFiscalNumber: null, date: '2026-10-05', paidOn: '2026-10-20',
  purchaseCategory: '02', paymentForm: '01', servicesAmount: 0, goodsAmount: 1000, taxAmount: 180,
  taxWithheld: 0, taxProportional: 0, taxToCost: 0, incomeTaxWithheld: 0, isrRetentionType: null,
  exciseAmount: 0, otherTaxes: 0, serviceCharge: 0, total: 1180, ...over,
});

const sale = (over: Record<string, unknown> = {}) => ({
  isCreditNote: false, exchangeRate: 1, netAmount: 10000, taxedAmount: 10000, exemptAmount: 0,
  tax: 1800, taxWithheld: 0, isExport: false, ...over,
});

const line = (worksheet: { lines: Array<{ code: string; amount: number }> }, code: string) =>
  worksheet.lines.find((l) => l.code === code)?.amount;

describe('IT-1', () => {
  it('ITBIS payable is what was charged less what was paid on purchases', () => {
    const it1 = buildIt1({ rnc: '131-00000-1', year: 2026, month: 10, sales: [sale()], purchases: [purchase()] });
    expect(line(it1, 'it1.tax.charged')).toBe(1800);
    expect(line(it1, 'it1.purchases.tax_deductible')).toBe(180);
    expect(it1.payable).toBe(1620);
    expect(it1.creditForward).toBe(0);
    expect(it1.rnc).toBe('131000001');
    expect(it1.period).toBe('202610');
  });

  it('a credit note reduces sales and the ITBIS charged', () => {
    const it1 = buildIt1({
      rnc: '1', year: 2026, month: 10, purchases: [],
      sales: [sale(), sale({ isCreditNote: true, netAmount: 1000, taxedAmount: 1000, tax: 180 })],
    });
    expect(line(it1, 'it1.sales.total')).toBe(9000);
    expect(line(it1, 'it1.tax.charged')).toBe(1620);
  });

  it('a foreign-currency sale is declared in the base currency', () => {
    const it1 = buildIt1({ rnc: '1', year: 2026, month: 10, purchases: [], sales: [sale({ exchangeRate: 60, netAmount: 100, taxedAmount: 100, tax: 18 })] });
    expect(line(it1, 'it1.tax.charged')).toBe(1080);
  });

  it('ITBIS taken to cost is not deductible, and proportional ITBIS follows the taxed share of sales', () => {
    const it1 = buildIt1({
      rnc: '1', year: 2026, month: 10,
      sales: [sale({ netAmount: 10000, taxedAmount: 7500, exemptAmount: 2500, tax: 1350 })],
      purchases: [purchase({ taxAmount: 1000, taxToCost: 100, taxProportional: 400 })],
    });
    expect(it1.proportionalityFactor).toBe(0.75);
    expect(line(it1, 'it1.purchases.tax_proportional_deductible')).toBe(300);
    // 1000 paid − 100 to cost − 400 proportional + 300 deductible share.
    expect(line(it1, 'it1.purchases.tax_deductible')).toBe(800);
  });

  it('withholdings by customers and the prior credit reduce the balance, and an excess carries forward', () => {
    const it1 = buildIt1({
      rnc: '1', year: 2026, month: 10, priorCredit: 2000,
      sales: [sale({ taxWithheld: 300 })], purchases: [purchase()],
    });
    expect(it1.payable).toBe(0);
    expect(it1.creditForward).toBe(680);
  });

  it('a supplier credit note reduces the deductible ITBIS', () => {
    const it1 = buildIt1({
      rnc: '1', year: 2026, month: 10, sales: [sale()],
      purchases: [purchase(), purchase({ kind: 'credit_note', taxAmount: 18 })],
    });
    expect(line(it1, 'it1.purchases.tax_deductible')).toBe(162);
  });
});

describe('IR-17', () => {
  it('groups ISR withheld by retention type and totals the ITBIS withheld', () => {
    const ir17 = buildIr17({
      rnc: '131000001', year: 2026, month: 10,
      paid: [
        purchase({ servicesAmount: 50000, goodsAmount: 0, incomeTaxWithheld: 5000, isrRetentionType: '02', taxWithheld: 2700 }),
        purchase({ servicesAmount: 20000, goodsAmount: 0, incomeTaxWithheld: 2000, isrRetentionType: '02' }),
        purchase({ servicesAmount: 30000, goodsAmount: 0, incomeTaxWithheld: 3000, isrRetentionType: '01' }),
      ],
    });
    expect(ir17.isr).toEqual([
      { type: '01', count: 1, base: 30000, withheld: 3000 },
      { type: '02', count: 2, base: 70000, withheld: 7000 },
    ]);
    expect(ir17.itbis).toEqual({ type: 'ITBIS', count: 1, base: 50000, withheld: 2700 });
    expect(ir17.totalWithheld).toBe(12700);
  });
});

describe('worksheetCsv', () => {
  it('writes codes and two-decimal amounts, quoting what needs it', () => {
    expect(worksheetCsv([['rnc', '131000001'], ['it1.tax.charged', 1800], ['name', 'A, B']])).toBe(
      'rnc,131000001\nit1.tax.charged,1800.00\nname,"A, B"',
    );
  });
});
