import type { TenantCountryPackResponse } from '@virteex/shared/types';
import { countryPackFor } from '../../contracts/country-pack/country-pack';
import { findCountryProfile } from './country-profiles';

/**
 * The half of a country pack the browser reads, with the profile facts the pack does not carry.
 *
 * The pack lives in `contracts/` so provisioning can read it, and therefore cannot import the
 * country profiles; the authority's name and the address divisions are added here, where both are
 * in reach. The seeds — payment methods, payroll parameters and concepts — are left out: they are
 * what provisioning writes, and the browser reads the rows, not the recipe.
 */
export function publicCountryPack(countryCode: string | null | undefined): TenantCountryPackResponse {
  const pack = countryPackFor(countryCode);
  const profile = pack.countryCode ? findCountryProfile(pack.countryCode) : undefined;
  return {
    countryCode: pack.countryCode,
    fiscalAuthority: profile?.fiscalAuthority ?? null,
    documents: { ...pack.documents },
    withholding: { ...pack.withholding },
    taxes: { ...pack.taxes },
    paymentMethods: {
      catalogue: pack.paymentMethods.catalogue,
      authority: pack.paymentMethods.authority,
    },
    payroll: { statutoryParameters: pack.payroll.statutoryParameters },
    fiscalReturns: {
      generator: pack.fiscalReturns.generator,
      dueDay: pack.fiscalReturns.dueDay,
      prepareWith: [...pack.fiscalReturns.prepareWith],
    },
    examples: { ...pack.examples },
    divisionLabel: profile?.address.divisionLabel ?? null,
    divisions: (profile?.address.divisions ?? []).map(({ code, name }) => ({ code, name })),
  };
}
