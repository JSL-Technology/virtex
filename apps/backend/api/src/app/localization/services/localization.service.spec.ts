import { NotFoundException } from '@nestjs/common';
import { LocalizationService } from './localization.service';
import { supportedCountryCodes } from '../fiscal/country-profiles';
import { I18nService } from '../../i18n/i18n.service';

/**
 * The two methods the public signup form depends on.
 *
 * Both replace behaviour that failed open. `getConfig` used to ask a strategy for its config and
 * fall back to a "generic" strategy for any country it did not know — returning a config with no
 * `fiscalRegionId`, which the form then submitted as `undefined`. `lookupTaxId` forwarded whatever
 * string arrived straight to a government registry, unauthenticated and unvalidated.
 */
describe('LocalizationService — public country configuration', () => {
  const REGION_ID = '11111111-1111-4111-8111-111111111111';

  function makeService(overrides: Partial<Record<string, unknown>> = {}): LocalizationService {
    const fiscalRegionRepository = {
      findOne: jest.fn().mockResolvedValue({ id: REGION_ID, countryCode: 'DO' }),
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn(),
      save: jest.fn(),
      create: jest.fn((row: unknown) => row),
      ...(overrides.fiscalRegionRepository as object),
    };

    return new LocalizationService(
      fiscalRegionRepository as never,
      {} as never, // ChartOfAccountsService — not reached by these tests
      {} as never, // TaxesService
      (overrides.doStrategy as never) ?? ({ getTaxIdDetails: jest.fn() } as never),
      { getTaxIdDetails: jest.fn() } as never,
      { getTaxIdDetails: jest.fn() } as never,
      {} as never, // TenantBookkeepingProvisioner — only reached when a tenant is provisioned
      // The real catalogue, not a stub: the public country config is asserted on for its
      // TRANSLATED labels, so a stub returning the key would make the test pass on a lie.
      new I18nService(),
    );
  }

  describe('getPublicCountryConfig', () => {
    it('returns the fiscal region id the registration payload must reference', async () => {
      const config = await makeService().getPublicCountryConfig('DO');
      expect(config.fiscalRegionId).toBe(REGION_ID);
      expect(config.countryCode).toBe('DO');
      expect(config.taxIdLabel).toBe('RNC / Cédula');
      expect(config.currency).toBe('DOP');
      expect(config.phoneCode).toBe('+1');
    });

    it('is case-insensitive about the country code', async () => {
      await expect(makeService().getPublicCountryConfig('do')).resolves.toMatchObject({
        countryCode: 'DO',
      });
    });

    it('refuses an unsupported country instead of returning a generic config', async () => {
      await expect(makeService().getPublicCountryConfig('FR')).rejects.toThrow(NotFoundException);
    });

    it('refuses rather than returning a config with no fiscal region id', async () => {
      // Seeding runs at boot from the same list. If the row is missing, the seed failed — and a
      // config without a region id is precisely how tenants ended up with no chart of accounts.
      const service = makeService({
        fiscalRegionRepository: { findOne: jest.fn().mockResolvedValue(null) },
      });
      await expect(service.getPublicCountryConfig('DO')).rejects.toThrow(NotFoundException);
    });

    it('carries the coded divisions the country publishes', async () => {
      const config = await makeService().getPublicCountryConfig('DO');
      expect(config.address.divisionLabel).toBe('Provincia');
      expect(config.address.divisions).toEqual(
        expect.arrayContaining([{ code: '01', name: 'Distrito Nacional' }]),
      );
    });
  });

  describe('getSupportedCountries', () => {
    it('lists exactly the countries that can actually be provisioned', () => {
      const listed = makeService()
        .getSupportedCountries()
        .map((c) => c.countryCode);
      expect(listed).toEqual(supportedCountryCodes());
    });
  });

  describe('lookupTaxId', () => {
    it('does not reach the registry when the check digit is wrong', async () => {
      // The endpoint is public and the registry belongs to a government. Forwarding unvalidated
      // input to it spends a third party's rate limit under this platform's IP reputation.
      const doStrategy = { getTaxIdDetails: jest.fn() };
      const service = makeService({ doStrategy });

      const result = await service.lookupTaxId('DO', '101010102');

      expect(result).toMatchObject({ valid: false, found: false, legalName: null });
      expect(doStrategy.getTaxIdDetails).not.toHaveBeenCalled();
    });

    it('returns the registry name when the identifier resolves', async () => {
      const doStrategy = {
        getTaxIdDetails: jest.fn().mockResolvedValue({ legalName: 'ACME SRL', status: 'ACTIVO' }),
      };
      const service = makeService({ doStrategy });

      await expect(service.lookupTaxId('DO', '101010101')).resolves.toMatchObject({
        valid: true,
        found: true,
        legalName: 'ACME SRL',
        status: 'ACTIVO',
      });
    });

    it('stays valid when the registry is unreachable', async () => {
      // The check digit is authoritative for accepting the identifier. A registry outage must not
      // close the signup funnel.
      const doStrategy = {
        getTaxIdDetails: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      };
      const service = makeService({ doStrategy });

      await expect(service.lookupTaxId('DO', '101010101')).resolves.toMatchObject({
        valid: true,
        found: false,
        legalName: null,
      });
    });

    it('reports not-found rather than a name when the registry answers with nothing', async () => {
      const doStrategy = { getTaxIdDetails: jest.fn().mockResolvedValue(null) };
      const service = makeService({ doStrategy });

      await expect(service.lookupTaxId('DO', '101010101')).resolves.toMatchObject({
        valid: true,
        found: false,
      });
    });

    it('refuses a country the product does not sell to', async () => {
      await expect(makeService().lookupTaxId('FR', '12345678901')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('isValidTaxId', () => {
    it('is offline, total and never permissive for an unknown country', () => {
      const service = makeService();
      expect(service.isValidTaxId('DO', '101010101')).toBe(true);
      expect(service.isValidTaxId('DO', '101010102')).toBe(false);
      expect(service.isValidTaxId('FR', '101010101')).toBe(false);
      expect(service.isSupportedCountry('FR')).toBe(false);
      expect(service.isSupportedCountry('MX')).toBe(true);
    });
  });
});
