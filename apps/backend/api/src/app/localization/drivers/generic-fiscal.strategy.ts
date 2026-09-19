import { Injectable } from '@nestjs/common';
import { BaseTaxIdRegistryLookup } from './tax-id-registry-lookup';

/**
 * The fallback registry: no external lookup. `getConfig` (`taxIdLabel: 'Tax ID'`, `taxIdRegex: '.*'`)
 * and `validateTaxId` (`return true`, which accepted anything) were removed — the catalogue refuses a
 * country it has no rule for instead of waving it through.
 */
@Injectable()
export class GenericFiscalStrategy extends BaseTaxIdRegistryLookup {
  async getTaxIdDetails(_taxId: string): Promise<any> {
    return null; // No external lookup
  }
}
