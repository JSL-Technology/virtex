import type { TaxIdLookupResult } from '../fiscal/public-country-config';

/**
 * Looking a fiscal identifier up in the authority's registry, to pre-fill a legal name.
 *
 * Validation is not here: it is arithmetic over the market's own documents and checks, and every
 * module reaches it through the market registry (`validateTaxId`, `fiscalIdentifierFor` in
 * `markets`). What only localization can do is ask a third party — always advisory, never a gate:
 * a registry being down must not stop anyone from signing up.
 */
export type { TaxIdLookupResult };

export abstract class TaxIdRegistryPort {
  abstract lookupTaxId(
    countryCode: string,
    taxId: string,
  ): Promise<TaxIdLookupResult>;
}
