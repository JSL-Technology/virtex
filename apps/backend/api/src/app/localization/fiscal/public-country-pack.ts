import type { FiscalReturnGenerator, TenantCountryPackResponse } from '@virteex/shared/types';
import { marketFor } from '../../markets';

/**
 * What the browser reads about the tenant's market (`GET /localization/country-pack`): the
 * capabilities and presentation its screens branch on, never the seeds provisioning writes — the
 * browser reads the rows, not the recipe.
 */
export function publicCountryPack(countryCode: string | null | undefined): TenantCountryPackResponse {
  const market = marketFor(countryCode);
  const profile = market.profile;
  return {
    countryCode: market.code,
    fiscalAuthority: profile?.fiscalAuthority ?? null,
    documents: {
      fiscalNumbering: market.documents.fiscalNumbering,
      supplierFiscalNumber: market.purchases.supplierFiscalNumber,
      supplierDocumentNumberKey: market.purchases.receivedDocument.labelKey,
      purchaseClassification: market.purchases.purchaseClassification,
    },
    withholding: { applies: market.taxes.withholding.applies },
    taxes: { model: market.taxes.model, nameKey: market.taxes.nameKey },
    paymentMethods: { catalogue: market.payments.catalogue, authority: market.payments.authority },
    payroll: { statutoryParameters: market.payroll.statutoryParameters },
    fiscalReturns: {
      generator: market.returns.generator as FiscalReturnGenerator | null,
      dueDay: market.returns.dueDay,
      prepareWith: [...market.returns.prepareWith],
    },
    examples: profile ? { ...profile.examples } : { city: '', postalCode: null, phone: '' },
    divisionLabel: profile?.address.divisionLabel ?? null,
    divisions: (profile?.address.divisions ?? []).map(({ code, name }) => ({ code, name })),
  };
}
