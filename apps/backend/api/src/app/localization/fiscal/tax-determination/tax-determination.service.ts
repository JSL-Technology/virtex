import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { COUNTRY_TAX_SCHEMES } from '../country-tax-schemes';
import {
  TAX_DETERMINATION_PROVIDERS,
  TaxDetermination,
  TaxDeterminationProvider,
  TaxDeterminationRequest,
} from './tax-determination.types';
import { TenantJurisdictionProvider } from './tenant-jurisdiction.provider';

/**
 * Which rate a sale bears, in the markets where no national rate exists.
 *
 * `COUNTRY_TAX_SCHEMES` marks the United States and Brazil `configurationRequired` because their
 * base is sub-national, and `allowedTaxFractions` therefore constrained nothing for them — so the
 * rate arrived on the request and nothing checked it. A product sold in the United States charged
 * whatever number reached the API: no jurisdiction determination, no destination sourcing, no
 * record of where the tenant has nexus, and no way for the tenant to state any of it.
 *
 * Providers answer in order and the first that supports the country wins, so a tenant that
 * connects Avalara or Vertex gets it and everyone else gets their own registered jurisdictions.
 */
@Injectable()
export class TaxDeterminationService {
  private readonly logger = new Logger(TaxDeterminationService.name);
  private readonly providers: TaxDeterminationProvider[];

  constructor(
    private readonly tenantJurisdictions: TenantJurisdictionProvider,
    /**
     * Providers registered by other modules, in priority order. Optional: the tenant's own
     * jurisdictions are always available and are the last resort.
     */
    @Optional()
    @Inject(TAX_DETERMINATION_PROVIDERS)
    externalProviders?: TaxDeterminationProvider[],
  ) {
    this.providers = [...(externalProviders ?? []), this.tenantJurisdictions];
  }

  /**
   * Whether this country's rate has to be determined rather than taken from a table.
   *
   * The same flag that marks the country's scheme as needing configuration: there is no national
   * rate to validate against, so the rate has to come from somewhere that knows the address.
   */
  requiresDetermination(countryCode: string | null | undefined): boolean {
    if (!countryCode) return false;
    return COUNTRY_TAX_SCHEMES[countryCode.toUpperCase()]?.configurationRequired === true;
  }

  async determine(request: TaxDeterminationRequest): Promise<TaxDetermination> {
    const country = request.destination.countryCode?.toUpperCase() ?? '';
    const provider = this.providers.find((candidate) => candidate.supports(country));
    if (!provider) {
      return {
        rate: 0,
        components: [],
        outcome: 'NOT_DETERMINABLE',
        reasonKey: 'LOCALIZATION.SIN_PROVEEDOR_DETERMINACION',
        reasonParams: { countryCode: country },
        source: 'none',
      };
    }

    const determination = await provider.determine(request);
    if (determination.outcome !== 'DETERMINED') {
      this.logger.warn(
        `Determinación de impuesto ${determination.outcome} para ${country}/` +
          `${request.destination.stateCode ?? '—'} en ${request.asOf} (${determination.source}).`,
      );
    }
    return determination;
  }
}
