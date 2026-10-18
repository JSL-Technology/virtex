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
    supplierDocumentNumberKey: 'accounts_payable.form.ncf',
    purchaseClassification: true,
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
  const stub: Pick<CountryPackService, 'pack' | 'withholding' | 'fiscalNumbering'> = {
    pack: state.asReadonly(),
    withholding: computed(() => state()?.withholding.applies ?? false),
    fiscalNumbering: computed(() => state()?.documents.fiscalNumbering ?? false),
  };
  return { provide: CountryPackService, useValue: stub };
}
