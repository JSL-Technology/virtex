import { Injectable } from '@nestjs/common';

/**
 * A country's external tax-id registry — enrichment only, never labels or validation.
 *
 * This was `FiscalStrategy`, once meant to own a country's whole fiscal behaviour. It also declared
 * `getConfig()` — which returned a hardcoded `taxIdLabel` (`'RNC'`, `'EIN/SSN'`, `'Tax ID'`) and a
 * per-country `taxIdRegex`/`taxIdMask` — and `validateTaxId()`, which told a Dominican RNC from a
 * cédula by COUNTING DIGITS (9 vs 11) with the arithmetic inline. Both became a second source of
 * truth the moment the identity-document catalogue took over labels and validation, and both were
 * left with zero callers. They are gone: keeping them on the interface was an invitation to re-wire
 * `taxIdLabel: 'RNC'` as a universal, or to count digits to name a document again — the exact thing
 * the catalogue was built to end.
 *
 * What remains is the one job that is legitimately per-country AND has a live caller: looking a
 * taxpayer up in the authority's own registry (the DGII's RNC service, for the Dominican Republic)
 * to enrich a record with its registered legal name. A country with no registry has no
 * implementation, and `LocalizationService.lookupTaxId` takes its no-driver branch. Labels come from
 * `fiscalIdentifierLabel`, validation from `validateTaxId` — both off the catalogue, for every
 * market, with no second opinion here.
 */
export interface TaxIdRegistryLookup {
  /** Enrich a tax id from the authority's registry; null when it cannot be resolved. */
  getTaxIdDetails(taxId: string): Promise<any>;
}

@Injectable()
export abstract class BaseTaxIdRegistryLookup implements TaxIdRegistryLookup {
  abstract getTaxIdDetails(taxId: string): Promise<any>;
}
