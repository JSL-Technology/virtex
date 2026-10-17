/**
 * Tax-identifier validation, as other modules may use it.
 *
 * The validators live in `fiscal/` with the rest of the country catalogue; this is the surface the
 * module offers, so a purchase can check its supplier's RNC without depending on how localization
 * organises its insides.
 */
import type { TaxIdLookupResult } from '../fiscal/public-country-config';

export { isValidDominicanTaxId, TaxpayerKind } from '../fiscal/tax-id-validators';
export {
  validateTaxId,
  canonicalizeTaxId,
  fiscalIdentifierFor,
  fiscalIdentifierLabel,
  identityDocumentLabel,
} from '../fiscal/identity-document-catalogue';
export type { TaxIdLookupResult };

/**
 * The tax authority's taxpayer registry, as other modules may consult it — to propose a supplier's
 * legal name from the RNC printed on a bill. An unreachable registry answers `found: false`, not an
 * error: the check digit decides validity, the lookup only saves typing.
 */
export abstract class TaxIdRegistryPort {
  abstract lookupTaxId(
    countryCode: string,
    taxId: string,
  ): Promise<TaxIdLookupResult>;
}
