import { DataSource } from 'typeorm';
import { Organization } from '../../../organizations/entities/organization.entity';
import {
  JurisdictionLevel,
  SourcingRule,
  TaxJurisdiction,
} from '../entities/tax-jurisdiction.entity';
import { TenantJurisdictionProvider } from './tenant-jurisdiction.provider';
import { TaxDeterminationService } from './tax-determination.service';

/**
 * Sales tax where there is no national rate.
 *
 * `COUNTRY_TAX_SCHEMES` marks the United States and Brazil `configurationRequired` because their
 * base is sub-national, and `allowedTaxFractions` therefore constrained nothing for them — so the
 * rate arrived on the request and nothing checked it. For a product sold in the United States that
 * is not a missing feature: there was no jurisdiction determination, no destination sourcing, no
 * record of where the tenant has nexus, and no way for the tenant to state any of it.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('sales tax determination', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let determination: TaxDeterminationService;
  let organizationId: string;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
      entities: [`${__dirname}/../../../**/*.entity.{js,ts}`],
    });
    await dataSource.initialize();
    determination = new TaxDeterminationService(new TenantJurisdictionProvider(dataSource));
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Nexo ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/New_York',
        country: 'US',
      }),
    );
    organizationId = org.id;
  });

  afterEach(async () => {
    await dataSource.getRepository(Organization).delete({ id: organizationId });
  });

  const register = (row: Partial<TaxJurisdiction>) =>
    dataSource.getRepository(TaxJurisdiction).save(
      dataSource.getRepository(TaxJurisdiction).create({
        organizationId,
        countryCode: 'US',
        isRegistered: true,
        sourcing: SourcingRule.DESTINATION,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        ...row,
      } as TaxJurisdiction),
    );

  const determine = (
    destination: Record<string, unknown>,
    options: { origin?: Record<string, unknown>; asOf?: string } = {},
  ) =>
    determination.determine({
      organizationId,
      destination: { countryCode: 'US', ...destination } as never,
      origin: (options.origin as never) ?? null,
      asOf: options.asOf ?? '2026-06-15',
    });

  it('knows which markets need determining at all', () => {
    // The same flag that marks a country's scheme as needing configuration: no national rate to
    // validate against, so the rate has to come from somewhere that knows the address.
    expect(determination.requiresDetermination('US')).toBe(true);
    expect(determination.requiresDetermination('BR')).toBe(true);
    expect(determination.requiresDetermination('DO')).toBe(false);
    expect(determination.requiresDetermination(null)).toBe(false);
  });

  it('adds the state, county, city and special-district rates at the delivery address', async () => {
    await register({ stateCode: 'TX', level: JurisdictionLevel.STATE, name: 'Texas', rate: 0.0625 });
    await register({ stateCode: 'TX', county: 'Dallas', level: JurisdictionLevel.COUNTY, name: 'Dallas County', rate: 0.005 });
    await register({ stateCode: 'TX', city: 'Dallas', level: JurisdictionLevel.CITY, name: 'City of Dallas', rate: 0.01 });
    await register({ stateCode: 'TX', city: 'Dallas', level: JurisdictionLevel.SPECIAL, name: 'DART', rate: 0.01 });

    const result = await determine({ stateCode: 'TX', county: 'Dallas', city: 'Dallas' });

    expect(result.outcome).toBe('DETERMINED');
    // 6.25 + 0.5 + 1 + 1 = 8.75 %, which is what Dallas actually charges.
    expect(result.rate).toBeCloseTo(0.0875, 6);
    expect(result.components).toHaveLength(4);
    expect(result.source).toBe('tenant-jurisdictions');
  });

  it('charges only the state rate at an address with no local rows', async () => {
    await register({ stateCode: 'TX', level: JurisdictionLevel.STATE, name: 'Texas', rate: 0.0625 });
    await register({ stateCode: 'TX', city: 'Dallas', level: JurisdictionLevel.CITY, name: 'City of Dallas', rate: 0.01 });

    // The same product, delivered to a different town in the same state, is a different rate. A
    // single national figure — which is what the request used to carry — is wrong in both places.
    const result = await determine({ stateCode: 'TX', city: 'Austin' });

    expect(result.rate).toBeCloseTo(0.0625, 6);
    expect(result.components).toHaveLength(1);
  });

  it('charges nothing where the seller is not registered, and says that is why', async () => {
    await register({ stateCode: 'TX', level: JurisdictionLevel.STATE, name: 'Texas', rate: 0.0625 });

    const result = await determine({ stateCode: 'CA', city: 'Los Angeles' });

    // Not an error and not an exemption. Economic nexus depends on the seller's sales volume into
    // the state, which is their determination to make, so registration is recorded rather than
    // inferred — and the document says the sale was untaxed for want of nexus.
    expect(result.outcome).toBe('NO_NEXUS');
    expect(result.rate).toBe(0);
    expect(result.reasonKey).toBe('LOCALIZATION.SIN_REGISTRO_EN_JURISDICCION');
  });

  it('honours a registration the tenant has switched off', async () => {
    await register({ stateCode: 'TX', level: JurisdictionLevel.STATE, name: 'Texas', rate: 0.0625, isRegistered: false });

    const result = await determine({ stateCode: 'TX' });
    expect(result.outcome).toBe('NO_NEXUS');
  });

  it('refuses to price an address with no state rather than guessing', async () => {
    await register({ stateCode: 'TX', level: JurisdictionLevel.STATE, name: 'Texas', rate: 0.0625 });

    const result = await determine({ city: 'Dallas' });

    expect(result.outcome).toBe('NOT_DETERMINABLE');
    expect(result.reasonKey).toBe('LOCALIZATION.DETERMINACION_REQUIERE_DIVISION');
  });

  it("prices an intrastate sale at the seller's rate in an origin-sourced state", async () => {
    await register({
      stateCode: 'AZ',
      level: JurisdictionLevel.STATE,
      name: 'Arizona',
      rate: 0.056,
      sourcing: SourcingRule.ORIGIN,
    });
    await register({ stateCode: 'AZ', city: 'Phoenix', level: JurisdictionLevel.CITY, name: 'Phoenix', rate: 0.023 });
    await register({ stateCode: 'AZ', city: 'Tucson', level: JurisdictionLevel.CITY, name: 'Tucson', rate: 0.026 });

    // Seller in Phoenix, buyer in Tucson, both in Arizona: an origin-sourced state charges the
    // seller's city. Getting this backwards is not an error anybody notices — it is a return that
    // is wrong by the difference between two towns, every month.
    const result = await determine(
      { stateCode: 'AZ', city: 'Tucson' },
      { origin: { countryCode: 'US', stateCode: 'AZ', city: 'Phoenix' } },
    );

    expect(result.rate).toBeCloseTo(0.079, 6);
    expect(result.components.map((c) => c.name)).toEqual(['Arizona', 'Phoenix']);
  });

  it('sources a sale across a state line to the destination even in an origin state', async () => {
    await register({
      stateCode: 'AZ',
      level: JurisdictionLevel.STATE,
      name: 'Arizona',
      rate: 0.056,
      sourcing: SourcingRule.ORIGIN,
    });
    await register({ stateCode: 'AZ', city: 'Tucson', level: JurisdictionLevel.CITY, name: 'Tucson', rate: 0.026 });

    const result = await determine(
      { stateCode: 'AZ', city: 'Tucson' },
      { origin: { countryCode: 'US', stateCode: 'NV', city: 'Las Vegas' } },
    );

    expect(result.components.map((c) => c.name)).toEqual(['Arizona', 'Tucson']);
  });

  it('prices a document at the rate in force on its own date', async () => {
    await register({
      stateCode: 'TX',
      level: JurisdictionLevel.STATE,
      name: 'Texas',
      rate: 0.06,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-03-31',
    });
    await register({
      stateCode: 'TX',
      level: JurisdictionLevel.STATE,
      name: 'Texas',
      rate: 0.0625,
      effectiveFrom: '2026-04-01',
    });

    // Rates change by ordinance mid-year, and a document issued in March has to keep being priced
    // at March's rate when it is credited in July.
    expect((await determine({ stateCode: 'TX' }, { asOf: '2026-02-10' })).rate).toBeCloseTo(0.06, 6);
    expect((await determine({ stateCode: 'TX' }, { asOf: '2026-06-15' })).rate).toBeCloseTo(0.0625, 6);
  });

  it('prefers a row that names the postal code over one that does not', async () => {
    await register({ stateCode: 'WA', level: JurisdictionLevel.STATE, name: 'Washington', rate: 0.065 });
    await register({ stateCode: 'WA', city: 'Seattle', level: JurisdictionLevel.CITY, name: 'Seattle', rate: 0.0335 });
    await register({
      stateCode: 'WA',
      city: 'Seattle',
      postalCode: '98104',
      level: JurisdictionLevel.CITY,
      name: 'Seattle — downtown district',
      rate: 0.0385,
    });

    const downtown = await determine({ stateCode: 'WA', city: 'Seattle', postalCode: '98104' });
    const elsewhere = await determine({ stateCode: 'WA', city: 'Seattle', postalCode: '98199' });

    // A postal code narrows a row; it does not define a jurisdiction — one ZIP can straddle two
    // cities — so a row carrying one wins only when it matches.
    expect(downtown.rate).toBeCloseTo(0.1035, 6);
    expect(elsewhere.rate).toBeCloseTo(0.0985, 6);
  });

  it('charges nothing at all for a tenant with no jurisdictions registered', async () => {
    const result = await determine({ stateCode: 'TX' });

    expect(result.outcome).toBe('NO_NEXUS');
    expect(result.reasonKey).toBe('LOCALIZATION.SIN_JURISDICCIONES_REGISTRADAS_PAIS');
  });
});
