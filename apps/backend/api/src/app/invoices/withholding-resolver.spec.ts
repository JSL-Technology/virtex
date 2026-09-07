import { DataSource } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { Customer } from '../customers/entities/customer.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { TenantWithholdingRegime } from '../localization/fiscal/entities/tenant-withholding-regime.entity';
import { TaxpayerType } from '../localization/fiscal/withholding-regimes';
import { WithholdingResolverService } from './services/withholding-resolver.service';

/**
 * Who withholds what, decided by the server.
 *
 * `taxWithholdingRate` and `incomeTaxWithholdingRate` used to arrive on the create-invoice request
 * as any fraction between 0 and 1, checked against nothing. Withholding is not a commercial term:
 * the rate follows from the payer's fiscal status, the payee's, and what is sold. Under-withhold
 * and the seller owes the difference with penalties; over-withhold and the buyer has been charged
 * money nobody had the authority to charge.
 *
 * These run against a real database because the tenant's own configured regimes are rows, and the
 * order of authority between them and the built-in catalogue is the part most likely to break.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('withholding resolution', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let resolver: WithholdingResolverService;
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
      entities: [`${__dirname}/../**/*.entity.{js,ts}`],
    });
    await dataSource.initialize();
    resolver = new WithholdingResolverService();
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  /**
   * A tenant in one country, with its own fiscal classification as the seller.
   *
   * Both parties decide the withholding, and the seller's half is not a constant: a *negocio de
   * único dueño* is a natural person for these purposes and its corporate customers withhold from
   * it at rates that do not apply between companies. Left unstated, a tenant is treated as a
   * company.
   */
  const tenantIn = async (country: string, sellerType?: TaxpayerType) => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Retenciones ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
        country,
      }),
    );
    organizationId = org.id;
    if (sellerType) {
      await dataSource.getRepository(OrganizationSettings).save(
        dataSource.getRepository(OrganizationSettings).create({
          organizationId: org.id,
          baseCurrency: 'DOP',
          taxpayerType: sellerType,
        }),
      );
    }
    return org.id;
  };

  const buyer = (taxpayerType: TaxpayerType | null) =>
    ({ id: '00000000-0000-4000-8000-000000000001', taxpayerType, country: 'DO' }) as Pick<
      Customer,
      'id' | 'taxpayerType' | 'country'
    >;

  afterEach(async () => {
    if (organizationId) {
      await dataSource.getRepository(Organization).delete({ id: organizationId });
    }
  });

  const resolve = (
    customer: Pick<Customer, 'id' | 'taxpayerType' | 'country'>,
    scope: 'SERVICES' | 'GOODS',
    request: Record<string, unknown> = {},
  ) =>
    resolver.resolve(dataSource.manager, organizationId, customer, scope, request);

  describe('the built-in catalogue', () => {
    beforeEach(() => tenantIn('DO'));

    it('withholds all of the ITBIS when a company pays an individual for services', async () => {
      // Norma General 02-05: a company paying a natural person for services withholds 100 % of the
      // ITBIS, and Ley 11-92 art. 309 withholds 10 % of the base on account of income tax. The
      // seller being a natural person is what triggers both — a *negocio de único dueño*, which is
      // a large share of this product's Dominican market.
      await tenantIn('DO', TaxpayerType.INDIVIDUAL);
      const resolved = await resolve(buyer(TaxpayerType.COMPANY), 'SERVICES');

      expect(resolved.taxWithholdingRate).toBe(1);
      expect(resolved.incomeTaxWithholdingRate).toBe(0.1);
      expect(resolved.regimeCodes).toEqual(['DO-ITBIS-100-PF', 'DO-ISR-10-SERV-PF']);
    });

    it('withholds nothing between two companies for the same services', async () => {
      // The same sale, with the seller a company: neither Dominican regime reaches it. The rate
      // depends on both parties, and treating every tenant as a company — or as an individual —
      // gets one of these two cases wrong on every invoice.
      const resolved = await resolve(buyer(TaxpayerType.COMPANY), 'SERVICES');

      expect(resolved.taxWithholdingRate).toBe(0);
      expect(resolved.incomeTaxWithholdingRate).toBe(0);
      expect(resolved.regimeCodes).toEqual([]);
    });

    it('withholds nothing from a company buying goods from a company', async () => {
      // Nothing in the catalogue reaches it: the ITBIS regimes are for individuals' services and
      // for the State, and the income-tax ones likewise. A rate here would be invented.
      const resolved = await resolve(buyer(TaxpayerType.COMPANY), 'GOODS');

      expect(resolved.taxWithholdingRate).toBe(0);
      expect(resolved.incomeTaxWithholdingRate).toBe(0);
      expect(resolved.regimeCodes).toEqual([]);
    });

    it('applies the State regimes when the buyer is a government body', async () => {
      const resolved = await resolve(buyer(TaxpayerType.GOVERNMENT), 'GOODS');

      // 30 % of the ITBIS and 5 % of the base — the rates for payments by the State to companies.
      expect(resolved.taxWithholdingRate).toBe(0.3);
      expect(resolved.incomeTaxWithholdingRate).toBe(0.05);
      expect(resolved.regimeCodes).toEqual(['DO-ITBIS-30-ESTADO', 'DO-ISR-5-ESTADO']);
    });

    it('withholds nothing from an unclassified customer rather than guessing', async () => {
      // The classification is assigned by the tax authority and recorded by the tenant. Inferring
      // it from the shape of a tax id or the presence of a company name is how a product invents a
      // filing on somebody else's behalf.
      const resolved = await resolve(buyer(null), 'SERVICES');

      expect(resolved.taxWithholdingRate).toBe(0);
      expect(resolved.incomeTaxWithholdingRate).toBe(0);
    });

    it('withholds nothing on a sale to a buyer abroad', async () => {
      const resolved = await resolve(buyer(TaxpayerType.FOREIGN), 'SERVICES');

      expect(resolved.regimeCodes).toEqual([]);
      expect(resolved.taxWithholdingRate).toBe(0);
    });
  });

  describe('a market the catalogue deliberately holds nothing for', () => {
    beforeEach(() => tenantIn('CO'));

    it('applies nothing automatically in Colombia', async () => {
      // ReteFuente depends on the concept, ReteIVA on whether the payer is a designated agent, and
      // ReteICA on the municipality. A national default would be a wrong filing everywhere but by
      // coincidence, so the product applies nothing and the tenant configures its own.
      const resolved = await resolve(buyer(TaxpayerType.WITHHOLDING_AGENT), 'SERVICES');

      expect(resolved.taxWithholdingRate).toBe(0);
      expect(resolved.incomeTaxWithholdingRate).toBe(0);
      expect(resolved.regimeCodes).toEqual([]);
    });

    it("uses the tenant's own configured regime", async () => {
      await dataSource.getRepository(TenantWithholdingRegime).save(
        dataSource.getRepository(TenantWithholdingRegime).create({
          organizationId,
          code: 'CO-RETEIVA-15',
          label: 'ReteIVA 15 %',
          kind: 'VAT',
          rate: 0.15,
          payers: [TaxpayerType.WITHHOLDING_AGENT],
          payees: [],
          scope: 'ANY',
          legalBasis: 'Estatuto Tributario art. 437-1',
          isActive: true,
        }),
      );

      const resolved = await resolve(buyer(TaxpayerType.WITHHOLDING_AGENT), 'SERVICES');

      expect(resolved.taxWithholdingRate).toBe(0.15);
      expect(resolved.regimeCodes).toEqual(['CO-RETEIVA-15']);
    });

    it('ignores a regime the tenant deactivated', async () => {
      await dataSource.getRepository(TenantWithholdingRegime).save(
        dataSource.getRepository(TenantWithholdingRegime).create({
          organizationId,
          code: 'CO-RETEIVA-15',
          label: 'ReteIVA 15 %',
          kind: 'VAT',
          rate: 0.15,
          payers: [TaxpayerType.WITHHOLDING_AGENT],
          payees: [],
          scope: 'ANY',
          legalBasis: 'Estatuto Tributario art. 437-1',
          isActive: false,
        }),
      );

      const resolved = await resolve(buyer(TaxpayerType.WITHHOLDING_AGENT), 'SERVICES');
      expect(resolved.taxWithholdingRate).toBe(0);
    });
  });

  describe("a tenant regime beside the country's own", () => {
    beforeEach(() => tenantIn('DO'));

    it('replaces the built-in rule it occupies the same slot as', async () => {
      // Rates move by decree between releases. A tenant whose authority changes the State's ITBIS
      // withholding cannot wait for a deployment to file correctly.
      await dataSource.getRepository(TenantWithholdingRegime).save(
        dataSource.getRepository(TenantWithholdingRegime).create({
          organizationId,
          code: 'DO-ITBIS-ESTADO-2027',
          label: 'ITBIS retenido al Estado — tasa vigente',
          kind: 'VAT',
          rate: 0.5,
          payers: [TaxpayerType.GOVERNMENT],
          payees: [],
          scope: 'ANY',
          legalBasis: 'Norma General publicada tras la última versión del producto',
          isActive: true,
        }),
      );

      const resolved = await resolve(buyer(TaxpayerType.GOVERNMENT), 'GOODS');

      expect(resolved.taxWithholdingRate).toBe(0.5);
      // The income-tax rule it did not replace still applies.
      expect(resolved.incomeTaxWithholdingRate).toBe(0.05);
      expect(resolved.regimeCodes).toEqual(['DO-ITBIS-ESTADO-2027', 'DO-ISR-5-ESTADO']);
    });
  });

  describe('a rate stated on the request', () => {
    beforeEach(() => tenantIn('DO', TaxpayerType.INDIVIDUAL));

    it('is accepted without ceremony when it agrees with the regime', async () => {
      const resolved = await resolve(buyer(TaxpayerType.COMPANY), 'SERVICES', {
        taxWithholdingRate: 1,
        incomeTaxWithholdingRate: 0.1,
      });

      // The client agreeing with the server is not an override and needs no justification.
      expect(resolved.override).toBeUndefined();
      expect(resolved.regimeCodes).toEqual(['DO-ITBIS-100-PF', 'DO-ISR-10-SERV-PF']);
    });

    it('is refused when it differs and no reason is given', async () => {
      await expect(
        resolve(buyer(TaxpayerType.COMPANY), 'SERVICES', { taxWithholdingRate: 0.3 }),
      ).rejects.toMatchObject({
        messageKey: 'INVOICES.RETENCION_NO_CORRESPONDE_AL_REGIMEN',
      });
    });

    it('is accepted as a recorded exception when the reason is given', async () => {
      const resolved = await resolve(buyer(TaxpayerType.COMPANY), 'SERVICES', {
        taxWithholdingRate: 0.3,
        withholdingOverrideReason: 'Cliente designado agente de retención al 30 % por la DGII el 2026-08-01.',
      });

      expect(resolved.taxWithholdingRate).toBe(0.3);
      // The unstated one keeps the regime's figure rather than falling to zero: the exception is
      // about the rate the caller named, not about the whole document.
      expect(resolved.incomeTaxWithholdingRate).toBe(0.1);
      expect(resolved.override?.reason).toContain('designado agente de retención');
      expect(resolved.override?.supersededRegimeCodes).toEqual([
        'DO-ITBIS-100-PF',
        'DO-ISR-10-SERV-PF',
      ]);
      // An overridden document names no regime: it followed none.
      expect(resolved.regimeCodes).toEqual([]);
    });

    it('refuses a withholding on a customer the regimes reach with nothing', async () => {
      // The case that made this whole change necessary: a client sending 0.30 for a buyer that
      // withholds nothing at all. It used to be stored verbatim.
      await expect(
        resolve(buyer(TaxpayerType.COMPANY), 'GOODS', { incomeTaxWithholdingRate: 0.3 }),
      ).rejects.toMatchObject({
        messageKey: 'INVOICES.RETENCION_NO_CORRESPONDE_AL_REGIMEN',
      });
    });

    it('refuses a blank reason as no reason', async () => {
      await expect(
        resolve(buyer(TaxpayerType.COMPANY), 'GOODS', {
          incomeTaxWithholdingRate: 0.3,
          withholdingOverrideReason: '   ',
        }),
      ).rejects.toMatchObject({
        messageKey: 'INVOICES.RETENCION_NO_CORRESPONDE_AL_REGIMEN',
      });
    });
  });
});
