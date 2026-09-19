import { Injectable } from '@nestjs/common';
import { BaseTaxIdRegistryLookup } from '../tax-id-registry-lookup';

/**
 * The United States has no free public tax-id registry (there is no DGII-style EIN/SSN service), so
 * the lookup resolves nothing and the record is not enriched — the same as any market with no
 * driver. `getConfig` (`taxIdLabel: 'EIN/SSN'`) and `validateTaxId` (`length === 9`) were removed:
 * the catalogue's `US.SSN` / `US.EIN` rows own the label and the shape now.
 */
@Injectable()
export class USStrategy extends BaseTaxIdRegistryLookup {
  async getTaxIdDetails(_taxId: string): Promise<any> {
    return null;
  }
}
