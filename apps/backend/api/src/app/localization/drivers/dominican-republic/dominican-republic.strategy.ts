import { Injectable, Logger } from '@nestjs/common';
import { BaseTaxIdRegistryLookup } from '../tax-id-registry-lookup';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';

/**
 * The Dominican Republic's tax-id registry: the DGII's public RNC lookup.
 *
 * Only `getTaxIdDetails` remains. `validateTaxId` (the RNC/cédula arithmetic distinguished by digit
 * length) and `getConfig` (`taxIdLabel: 'RNC'`) were removed — the catalogue owns labels and
 * validation now, so those were a dead second source of truth.
 */
@Injectable()
export class DominicanRepublicStrategy extends BaseTaxIdRegistryLookup {
  private readonly logger = new Logger(DominicanRepublicStrategy.name);

  constructor(private readonly httpService: HttpService) {
    super();
  }

  async getTaxIdDetails(taxId: string): Promise<any> {
    try {
      const url = `https://api.digital.gob.do/v3/rnc/${taxId}`;
      const { data } = await lastValueFrom(this.httpService.get(url));

      if (data) {
        return {
          taxId: data.rnc,
          legalName: data.name,
          status: data.status,
          industry: data.activity,
          isValid: true
        };
      }
      return null;
    } catch (error) {
        this.logger.error(`Error fetching DGII data for ${taxId}`, error);
        return null;
    }
  }
}
