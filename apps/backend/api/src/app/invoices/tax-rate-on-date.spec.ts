import { DataSource } from 'typeorm';
import { describeWithDb, openTestDataSource } from '../common/database/testing/integration-db';
import { statutoryTaxRatesOn } from '../localization/contracts/statutory-tax-rates.contract';
import { assertAllowedTaxRate, computeDocument } from './sales-tax.engine';
import { TaxTreatment } from './entities/invoice-line-item.entity';

/**
 * A sales document is validated against the rates in force on its own date (audit 2026-11-07,
 * LOC-06, FAC-TX-03): never today's rates for yesterday's document.
 */
describeWithDb('tax rate validation on the document date', () => {
  let ds: DataSource;
  beforeAll(async () => (ds = await openTestDataSource()));
  afterAll(async () => ds?.destroy());

  it('charges 12 % on an Ecuadorian invoice of March 2024 and refuses 15 % on it', async () => {
    const march = await statutoryTaxRatesOn(ds.manager, 'EC', '2024-03-15');
    const line = (taxRate: number) => ({ quantity: 1, unitPrice: 100, taxRate, taxTreatment: TaxTreatment.TAXED, isService: false });
    expect(computeDocument({ countryCode: 'EC', currencyCode: 'USD', statutoryTaxRates: march, taxDate: '2024-03-15', lines: [line(0.12)] }).tax).toBe(12);
    expect(() => assertAllowedTaxRate('EC', 0.15, [], march, '2024-03-15')).toThrow();
    const april = await statutoryTaxRatesOn(ds.manager, 'EC', '2024-04-01');
    expect(() => assertAllowedTaxRate('EC', 0.12, [], april, '2024-04-01')).toThrow();
  });

  it('refuses a date before every recorded period, unless the tenant states its own rate for it', async () => {
    const old = await statutoryTaxRatesOn(ds.manager, 'DO', '2012-12-31');
    expect(() => assertAllowedTaxRate('DO', 0.18, [], old, '2012-12-31')).toThrow(
      expect.objectContaining({ messageKey: 'invoices.no_tax_rate_in_force_on_date' }),
    );
    expect(() => assertAllowedTaxRate('DO', 0.16, [0.16], old, '2012-12-31')).not.toThrow();
  });
});
