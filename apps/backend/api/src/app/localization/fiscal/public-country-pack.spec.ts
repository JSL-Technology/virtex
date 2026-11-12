import { publicCountryPack } from './public-country-pack';

/** What the browser reads about the tenant's market: the capabilities and profile facts, never the seeds. */
describe('public country pack', () => {
  it('publishes the capabilities and the profile facts, not the seeds', () => {
    const pack = publicCountryPack('US');
    expect(pack.fiscalAuthority).toBe('IRS');
    expect(pack.divisions.map((division) => division.code)).toContain('TX');
    expect(pack.withholding.applies).toBe(false);
    expect(pack.paymentMethods).toEqual({ catalogue: 'EDITABLE', authority: null });
    expect(JSON.stringify(pack)).not.toContain('FICA');
  });

  it('answers a country the product is not sold in with the neutral market', () => {
    const pack = publicCountryPack('ES');
    expect(pack.countryCode).toBe('ES');
    expect(pack.fiscalAuthority).toBeNull();
    expect(pack.documents.fiscalNumbering).toBe(false);
    expect(pack.divisions).toEqual([]);
  });
});
