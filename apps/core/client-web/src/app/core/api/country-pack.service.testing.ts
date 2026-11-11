import { Provider, computed, signal } from '@angular/core';
import type { TenantCountryPackResponse } from '@virteex/shared/types';
import { CountryPackService } from './country-pack.service';

/** The Dominican pack: what the forms were written for, and what their tests assume. */
export const DOMINICAN_TEST_PACK: TenantCountryPackResponse = {
  countryCode: 'DO',
  fiscalAuthority: 'DGII',
  documents: {
    fiscalNumbering: true,
    supplierFiscalNumber: true,
    supplierDocumentNumberKey: 'localization.country_pack.supplier_document.ncf',
    supplierDocumentExample: 'B0100000001',
    purchaseClassification: true,
  },
  purchases: {
    fiscalAttributes: [
      {
        key: 'purchaseCategory',
        // The market's own wording travels in `labelKey`; this fallback is only read when a
        // market declares no key, and the catalogue is where interface text belongs.
        label: 'Kind of goods and services bought',
        labelKey: 'localization.country_pack.purchase_attribute.purchase_category',
        help: null,
        helpKey: 'localization.country_pack.purchase_attribute.purchase_category_help',
        required: true,
        type: 'select',
        multiple: false,
        options: [
          { code: '06', label: 'Merchandise purchases', labelKey: 'accounts_payable.purchase_category.merchandise_purchases' },
          { code: '09', label: 'Extraordinary expenses', labelKey: 'accounts_payable.purchase_category.extraordinary_expenses' },
        ],
        pattern: null,
        example: null,
      },
    ],
  },
  withholding: { applies: true },
  taxes: { model: 'NATIONAL_RATES', nameKey: 'invoices.new.tax_column_header' },
  paymentMethods: { catalogue: 'AUTHORITY_FIXED', authority: 'DGII' },
  payroll: { statutoryParameters: 'PLATFORM' },
  fiscalReturns: { generator: 'DGII', dueDay: 15, prepareWith: [] },
  examples: { city: 'Santo Domingo', postalCode: '10101', phone: '809 555 0100' },
  divisionLabel: 'Provincia',
  divisions: [],
};

/**
 * A `CountryPackService` for page tests: the company's market, by default the Dominican Republic.
 *
 * Document forms read the pack to decide which fields the market has. A page test that is not about
 * the market should neither see that request nor have the fields hidden while it "loads"; one that
 * is passes the pack it wants.
 */
export function provideTestCountryPack(pack: TenantCountryPackResponse | null = DOMINICAN_TEST_PACK): Provider {
  const state = signal<TenantCountryPackResponse | null>(pack);
  const stub: Pick<CountryPackService, 'pack' | 'withholding' | 'fiscalNumbering' | 'purchaseFiscalFields'> = {
    pack: state.asReadonly(),
    withholding: computed(() => state()?.withholding.applies ?? false),
    fiscalNumbering: computed(() => state()?.documents.fiscalNumbering ?? false),
    purchaseFiscalFields: computed(() => state()?.purchases.fiscalAttributes ?? []),
  };
  return { provide: CountryPackService, useValue: stub };
}
