import type { CountryPackFiscalField, FiscalReturnGenerator, TenantCountryPackResponse } from '@virteex/shared/types';
import { type FiscalFieldSpec, marketFor } from '../../markets';

/**
 * A field an authority asks about, as the browser reads it: what to label it, whether it is
 * required, and the only answers the server will accept. The form draws itself from this, so a
 * market that asks for something new asks for it on the screen too, with no screen changed.
 */
function publicFiscalField(field: FiscalFieldSpec): CountryPackFiscalField {
  return {
    key: field.key,
    label: field.label,
    labelKey: field.labelKey ?? null,
    help: field.help ?? null,
    helpKey: field.helpKey ?? null,
    required: field.required,
    type: field.type,
    multiple: field.multiple ?? false,
    options: (field.options ?? []).map((option) => ({
      code: option.code,
      label: option.label,
      labelKey: option.labelKey ?? null,
    })),
    pattern: field.pattern ?? null,
    example: field.example ?? null,
  };
}

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
      supplierDocumentExample: market.purchases.receivedDocument.example ?? null,
      purchaseClassification: market.purchases.purchaseClassification,
    },
    purchases: { fiscalAttributes: market.purchases.fiscalAttributes.map(publicFiscalField) },
    withholding: { applies: market.taxes.withholding.applies },
    taxes: { model: market.taxes.model, nameKey: market.taxes.nameKey },
    paymentMethods: { catalogue: market.payments.catalogue, authority: market.payments.authority },
    payroll: { statutoryParameters: market.payroll.statutoryParameters },
    einvoicing: {
      regime: market.einvoicing.regime,
      required: market.einvoicing.required,
      channel: market.einvoicing.channel,
      settingsFields: [...market.einvoicing.settingsFields],
      rangeSecret: market.einvoicing.rangeSecret,
    },
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
