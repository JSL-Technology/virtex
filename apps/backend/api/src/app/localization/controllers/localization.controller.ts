import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { LocalizationService } from '../services/localization.service';
import { IdentityDocumentService } from '../services/identity-document.service';
import {
  DocumentAppliesTo,
  DocumentContext,
} from '../fiscal/identity-document-catalogue';
import { FiscalRegion } from '../entities/fiscal-region.entity';
import { Public } from '../../security/decorators/public.decorator';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../security/principal';
import { TenantCountryResolver } from '../../shared/tenancy/tenant-country.resolver';

/**
 * Fiscal configuration the signup form needs before anyone has an account.
 *
 * `@Public()` and `@SkipThrottle()` used to sit on the class, which swept in the tax-id lookup
 * below — an unauthenticated, unlimited proxy to a government registry. That is somebody else's
 * rate limit being spent under this platform's IP reputation, and a free bulk-lookup service
 * operated by accident. Throttling is now per-route and the lookup is the strictest of them.
 */
@Controller('localization')
export class LocalizationController {
  constructor(
    private readonly localizationService: LocalizationService,
    private readonly identityDocuments: IdentityDocumentService,
    private readonly tenantCountry: TenantCountryResolver,
  ) {}

  /**
   * The identity documents a country issues, which every form that captures an identity reads.
   *
   * `@Public()` because the signup form needs it before an account exists, and because nothing
   * here is secret: it is the list of documents printed on the country's own tax forms. It is the
   * same endpoint the employee form, the customer form and the supplier form call, which is what
   * stops them drifting apart again — they previously had a hardcoded `<option>` list, no list at
   * all, and no list at all respectively.
   *
   * `appliesTo` and `usedFor` narrow it: an employee form asks for `individual` documents used in
   * `payroll`, which is how a Mexican tenant is offered the CURP and not the RFC.
   */
  @Get('countries/:countryCode/identity-document-types')
  @Public()
  @SkipThrottle()
  async getIdentityDocumentTypes(
    @Param('countryCode') countryCode: string,
    @Query('appliesTo') appliesTo?: DocumentAppliesTo,
    @Query('usedFor') usedFor?: DocumentContext,
  ) {
    const rows = await this.identityDocuments.listForCountry(countryCode, { appliesTo, usedFor });
    return rows.map((row) => ({
      code: row.code,
      countryCode: row.countryCode,
      labelKey: row.labelKey,
      labelVerbatim: row.labelVerbatim,
      example: row.example,
      // The pattern travels for immediate client-side feedback. The checksum deliberately does
      // NOT: the algorithm runs on the server, which is where the verdict is decided, and
      // shipping its name would invite a client to reimplement it and disagree.
      pattern: row.pattern,
      requirement: row.requirement,
      appliesTo: row.appliesTo,
      isDefault: row.isDefault,
    }));
  }

  /**
   * The identity documents the CALLER'S OWN tenant may use, without naming a country.
   *
   * Authenticated — no `@Public()` — so the country comes from the session rather than the URL.
   * The customer and supplier forms use this one; the signup form uses the `:countryCode` route
   * above, because at signup there is no tenant yet. Both read the same catalogue, which is the
   * point: sales, purchasing, payroll and registration disagreed about what a valid identifier was
   * precisely because each had its own source.
   */
  @Get('identity-document-types')
  async getTenantIdentityDocumentTypes(
    @CurrentUser() user: AuthenticatedUser,
    @Query('appliesTo') appliesTo?: DocumentAppliesTo,
    @Query('usedFor') usedFor?: DocumentContext,
  ) {
    const country = await this.tenantCountry.resolve(user.organizationId);
    const rows = await this.identityDocuments.listForCountry(country, { appliesTo, usedFor });
    return rows.map((row) => ({
      code: row.code,
      countryCode: row.countryCode,
      labelKey: row.labelKey,
      labelVerbatim: row.labelVerbatim,
      example: row.example,
      pattern: row.pattern,
      requirement: row.requirement,
      appliesTo: row.appliesTo,
      isDefault: row.isDefault,
    }));
  }

  /** The list of supported countries. Static, cheap, and needed to render the signup form. */
  @Get('fiscal-regions')
  @Public()
  @SkipThrottle()
  async getFiscalRegions(): Promise<FiscalRegion[]> {
    return this.localizationService.findAllFiscalRegions();
  }

  /**
   * The countries a tenant can actually be registered in.
   *
   * The signup form used to carry its own hardcoded list of eight, which disagreed with the six
   * seeded regions and with the three in `libs/api/country`. Two of the eight resolved to nothing
   * and produced a tenant with no fiscal package. The list now comes from the same table the
   * provisioning reads, so the form cannot offer a country the backend cannot serve.
   */
  @Get('countries')
  @Public()
  @SkipThrottle()
  getSupportedCountries() {
    return this.localizationService.getSupportedCountries();
  }

  /** One country's configuration: label, mask, currency, and the region id the form submits. */
  @Get('config/:countryCode')
  @Public()
  @SkipThrottle()
  async getConfig(@Param('countryCode') countryCode: string) {
    return this.localizationService.getPublicCountryConfig(countryCode);
  }

  /**
   * Look a tax id up with the country's fiscal authority, to pre-fill the legal name.
   *
   * Rate-limited hard and per-IP. It reaches an external government API, so the cost of abuse is
   * borne by a third party and paid for in this platform's standing with them.
   */
  @Get('lookup/:taxId')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async lookupTaxId(@Param('taxId') taxId: string, @Query('country') country: string) {
    return this.localizationService.lookupTaxId(country, taxId);
  }
}
