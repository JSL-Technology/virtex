import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { LocalizationService } from '../services/localization.service';
import { FiscalRegion } from '../entities/fiscal-region.entity';
import { Public } from '../../auth/decorators/public.decorator';

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
  constructor(private readonly localizationService: LocalizationService) {}

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
