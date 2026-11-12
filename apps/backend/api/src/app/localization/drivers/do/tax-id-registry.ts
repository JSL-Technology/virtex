import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { TaxIdRegistryLookup, TaxIdRegistryRecord } from '../tax-id-registry-lookup';

/**
 * The Dominican Republic's tax-id registry: the DGII's public RNC lookup.
 *
 * One market's driver, in that market's folder and reached through `TaxIdRegistryRegistry` — never
 * by its class name. `LocalizationService` used to inject it (and two classes that answered `null`)
 * and keep a map it filled by hand, so the next market with a registry was a change to a shared
 * service rather than a file of its own.
 *
 * Only `getTaxIdDetails` remains. `validateTaxId` (the RNC/cédula arithmetic distinguished by digit
 * length) and `getConfig` (`taxIdLabel: 'RNC'`) were removed — the catalogue owns labels and
 * validation now, so those were a dead second source of truth.
 */
@Injectable()
export class DominicanTaxIdRegistry implements TaxIdRegistryLookup {
  readonly countryCode = 'DO';

  private readonly logger = new Logger(DominicanTaxIdRegistry.name);

  constructor(private readonly httpService: HttpService) {}

  async getTaxIdDetails(taxId: string): Promise<TaxIdRegistryRecord | null> {
    try {
      const url = `https://api.digital.gob.do/v3/rnc/${taxId}`;
      const { data } = await lastValueFrom(this.httpService.get(url));

      if (data) {
        return {
          taxId: data.rnc,
          legalName: data.name,
          status: data.status,
          industry: data.activity,
          isValid: true,
        };
      }
      return null;
    } catch (error) {
      this.logger.error(`Error reading the registry for ${taxId}`, error);
      return null;
    }
  }
}
