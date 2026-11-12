import { Injectable } from '@nestjs/common';

/**
 * A market's external tax-id registry — enrichment only, never labels or validation.
 *
 * This was `FiscalStrategy`, once meant to own a country's whole fiscal behaviour. It also declared
 * `getConfig()` — which returned a hardcoded `taxIdLabel` (`'RNC'`, `'EIN/SSN'`, `'Tax ID'`) and a
 * per-country `taxIdRegex`/`taxIdMask` — and `validateTaxId()`, which told one market's tax id from
 * its national id by COUNTING DIGITS (9 vs 11) with the arithmetic inline. Both became a second
 * source of truth the moment the identity-document catalogue took over labels and validation, and
 * both were left with zero callers. They are gone: keeping them on the interface was an invitation
 * to re-wire one market's label as a universal, or to count digits to name a document again — the
 * exact thing the catalogue was built to end.
 *
 * What remains is the one job that is legitimately per-market AND has a live caller: looking a
 * taxpayer up in the authority's own registry to enrich a record with its registered legal name.
 * Labels come from `fiscalIdentifierLabel`, validation from `validateTaxId` — both off the
 * catalogue, for every market, with no second opinion here.
 */
export interface TaxIdRegistryLookup {
  /** ISO 3166-1 alpha-2 of the market whose registry this reads. */
  readonly countryCode: string;
  /** Enrich a tax id from the authority's registry; null when it cannot be resolved. */
  getTaxIdDetails(taxId: string): Promise<TaxIdRegistryRecord | null>;
}

/** What a registry answers about a taxpayer. Every field is the registry's, not the product's. */
export interface TaxIdRegistryRecord {
  taxId: string;
  legalName: string | null;
  status?: string | null;
  industry?: string | null;
  isValid?: boolean;
}

/**
 * Which market's registry can be asked, if any.
 *
 * Most markets publish no free lookup, and `null` says so: the caller leaves the record
 * unenriched. Two classes used to answer `null` from their own files — one for the United States,
 * one «generic» — and `LocalizationService` injected all three and filled a map by hand in its
 * constructor, so adding a market's registry meant editing the shared service. A driver now
 * declares the market it serves and is collected here.
 */
@Injectable()
export class TaxIdRegistryRegistry {
  private readonly byCountry: ReadonlyMap<string, TaxIdRegistryLookup>;

  constructor(drivers: readonly TaxIdRegistryLookup[]) {
    this.byCountry = new Map(drivers.map((driver) => [driver.countryCode.toUpperCase(), driver]));
  }

  /** The driver for a market, or null where its authority publishes no registry. */
  forCountry(countryCode: string | null | undefined): TaxIdRegistryLookup | null {
    return this.byCountry.get((countryCode ?? '').toUpperCase()) ?? null;
  }
}
