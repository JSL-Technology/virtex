import { DataSource } from 'typeorm';
import { testExchangeRateResolver } from './exchange-rate-resolver.testing';
import { ExchangeRateResolver } from './exchange-rate-resolver.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { numericTransformerNotNull, numericTransformerWithDefault } from '../common/database/numeric.transformer';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * XF-09 (audit 2026-11-07): foreign-currency postings with a stated rate were refused for every tenant.
 *
 *  - `fx_rate_tolerance` is `NOT NULL DEFAULT 0.02`, but the transformer wrote an explicit 0 for the
 *    unset value, so the tolerance band was 0 and any rate not identical to the quote was refused;
 *  - the stated rate went through the cents rounding of an amount, so 58.4567 reached the check as
 *    58.46 and 0.0042 (COP→USD) as 0.
 */
describe('numericTransformerWithDefault', () => {
  it('leaves an unset value unset, so the database default applies', () => {
    expect(numericTransformerWithDefault.to(undefined)).toBeUndefined();
    expect(numericTransformerNotNull.to(undefined)).toBe(0); // the defect, for contrast
    expect(numericTransformerWithDefault.to('0.05')).toBe(0.05);
    expect(numericTransformerWithDefault.to(null)).toBeNull();
  });
});

describe('a stated exchange rate on a journal entry', () => {
  const service = Object.create(JournalEntriesService.prototype) as unknown as { rate(value: unknown): number };

  it('keeps the six decimals of the column', () => {
    expect(service.rate(58.456789)).toBe(58.456789);
    expect(service.rate('0.0042')).toBe(0.0042);
    expect(service.rate(1.23456789)).toBe(1.234568);
  });

  it('still refuses what is not a number', () => {
    expect(() => service.rate('abc')).toThrow();
  });
});

describeWithDb('stated rate tolerance, against PostgreSQL', () => {
  let ds: DataSource;
  let organizationId: string;
  let resolver: ExchangeRateResolver;
  const DATE = '1999-01-04';

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'fx-tolerance');
    resolver = testExchangeRateResolver(ds);
    await ds.query(`DELETE FROM exchange_rate WHERE "fromCurrency" = 'DOP' AND "toCurrency" = 'USD' AND date = $1`, [DATE]);
    await ds.query(
      `INSERT INTO exchange_rate ("fromCurrency", "toCurrency", rate, date, rate_type, source) VALUES ('DOP', 'USD', 0.0172, $1, 'OFFICIAL', 'QA')`,
      [DATE],
    );
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM exchange_rate WHERE "fromCurrency" = 'DOP' AND "toCurrency" = 'USD' AND date = $1 AND source = 'QA'`, [DATE]);
    await dropTestOrganization(ds, organizationId);
  });

  it('a settings row created without a tolerance gets the 2 % of the schema', async () => {
    const repo = ds.getRepository(OrganizationSettings);
    const saved = await repo.save(repo.create({ organizationId }));
    const [row] = await ds.query(`SELECT fx_rate_tolerance FROM organization_settings WHERE id = $1`, [saved.id]);
    expect(Number(row.fx_rate_tolerance)).toBe(0.02);
  });

  it('a rate within the band is accepted as stated, one outside it is refused', async () => {
    const inside = await resolver.resolveForPosting(ds.manager, organizationId, 'DOP', 'USD', DATE, 0.0174);
    expect(inside.rate).toBe(0.0174);
    await expect(resolver.resolveForPosting(ds.manager, organizationId, 'DOP', 'USD', DATE, 0.018)).rejects.toMatchObject({
      messageKey: 'currencies.stated_rate_requested_deviates_too_far',
    });
  });
});
