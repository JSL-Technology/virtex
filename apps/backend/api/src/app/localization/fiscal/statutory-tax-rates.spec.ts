import { DataSource } from 'typeorm';
import { describeWithDb, openTestDataSource } from '../../common/database/testing/integration-db';
import { statutoryTaxRatesOn } from '../contracts/statutory-tax-rates.contract';
import { allMarkets } from '../../markets';

/**
 * National tax rates are dated data with their legal source (audit 2026-11-07, LOC-06, FAC-TX-03,
 * SP-03), read on the document's date.
 */
describeWithDb('statutory_tax_rates', () => {
  let ds: DataSource;
  beforeAll(async () => (ds = await openTestDataSource()));
  afterAll(async () => ds?.destroy());

  it('names the legal instrument of every rate', async () => {
    const missing = await ds.query(`SELECT country_code, tax_code FROM statutory_tax_rates WHERE btrim(legal_basis) = ''`);
    expect(missing).toEqual([]);
  });

  it("agrees with the country schemes on today's rates, so provisioning and validation cannot drift", async () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const { code: country, taxes: { scheme } } of allMarkets()) {
      const rows: Array<{ name: string; rate: string }> = await ds.query(
        `SELECT name, rate FROM statutory_tax_rates
          WHERE country_code = $1 AND effective_from <= $2 AND (effective_to IS NULL OR effective_to >= $2)`,
        [country, today],
      );
      const fromTable = rows.map((r) => `${r.name}|${Number(r.rate)}`).sort();
      const fromScheme = (scheme.configurationRequired ? [] : scheme.taxes).map((t) => `${t.name}|${t.rate}`).sort();
      expect({ country, rates: fromTable }).toEqual({ country, rates: fromScheme });
    }
  });

  it("validates an Ecuadorian document against the rate in force on ITS date (12 % → 15 % on 2024-04-01)", async () => {
    expect(await statutoryTaxRatesOn(ds.manager, 'EC', '2024-03-31')).toEqual([0.12, 0]);
    expect(await statutoryTaxRatesOn(ds.manager, 'EC', '2024-04-01')).toEqual([0.15, 0]);
  });

  it('returns nothing in force for a date before every recorded period', async () => {
    expect(await statutoryTaxRatesOn(ds.manager, 'DO', '2012-12-31')).toEqual([]);
  });

  it('constrains nothing at national level where there is no national table', async () => {
    expect(await statutoryTaxRatesOn(ds.manager, 'US', '2026-01-01')).toBeNull();
    expect(await statutoryTaxRatesOn(ds.manager, 'BR', '2026-01-01')).toBeNull();
  });

  it('refuses two overlapping periods of the same tax', async () => {
    await expect(
      ds.query(
        `INSERT INTO statutory_tax_rates (country_code, tax_code, name, rate, effective_from, legal_basis)
         VALUES ('EC', 'IVA_GENERAL', 'QA-overlap', 13, '2024-06-01', 'QA')`,
      ),
    ).rejects.toThrow(/overlaps/);
  });
});
