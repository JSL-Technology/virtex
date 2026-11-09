import type {
  CountryPackExamples,
  CountryPackReportLink,
  CountryTaxModel,
  FiscalReturnGenerator,
  PaymentMethodCatalogue,
} from '@virteex/shared/types';
import { allMarkets, marketFor, type Market } from '../../markets';
import type { PaymentMethodSeed, PayrollConceptSeed, PayrollParameterSeed } from '../../markets';

/**
 * The country pack: the legacy view of what a market declares about itself (QA C-06), derived from
 * the market packages (`markets/<cc>/`, docs/ARQUITECTURA_MERCADOS.md). It presents those
 * declarations in the shape provisioning, sales, purchasing, treasury and payroll were written
 * against, and goes away as they read `marketFor(cc)` directly.
 *
 * ## The failure this replaces
 *
 * A company registered in the United States received the Dominican product. Not through one bug but
 * through a dozen independent defaults, each of them written for the first market and never told
 * about the others: the payment methods were the DGII's seven codes, «fixed by the DGII»; the taxes
 * screen was empty and the invoice's tax column a free number; the payroll parameters were empty
 * with no way to add one; the fiscal returns page described the DGII formats; the default customer
 * was «Consumidor final»; the invoice asked about «Withholding at source».
 *
 * Each of those is a question with a per-market answer — does this market withhold at source? who
 * owns the payment-method list? which payroll rates does a company start from? — and the answer was
 * either hard-coded for the Dominican Republic or not asked at all. A pack is the list of those
 * questions, answered once per market. Screens and services read the answer; none of them names a
 * country.
 *
 * ## Why it lives in `contracts/`
 *
 * It is read by provisioning (the seed that runs inside the signup transaction and from backfill
 * migrations), by sales, purchasing, treasury and payroll, and by the localization endpoint that
 * serves its public half to the browser. `contracts/` is platform: anyone may depend on it and it
 * depends on no business module, which is what lets the provisioning seed in `database/` read it
 * without a forbidden edge. For the same reason it does not import the country profiles: the pack
 * states capabilities and seeds, and `localization` adds the profile facts (authority, divisions)
 * when it publishes the pack. `localization/fiscal/country-pack.spec.ts` checks the two agree on
 * which markets exist.
 *
 * ## Adding a market
 *
 * See `docs/ARQUITECTURA_MERCADOS.md`: a market is its package, `markets/<cc>/`, with the same files
 * as every other. Nothing here is edited to open one.
 */

export {
  PAYMENT_SETTLEMENT_KINDS,
  type PaymentMethodSeed,
  type PaymentSettlementKind,
  type PayrollConceptSeed,
  type PayrollParameterKind,
  type PayrollParameterSeed,
} from '../../markets';

export interface CountryPack {
  countryCode: string;

  /**
   * The statutory language of the market's books: what a new company's ledger, journals and seeded
   * names are written in. Mirrors the language of the market's profile locale
   * (`languageOfCountry`); the localization spec checks they agree. Null for an unknown market.
   */
  booksLanguage: 'es' | 'en' | 'pt' | null;

  documents: {
    fiscalNumbering: boolean;
    supplierFiscalNumber: boolean;
    supplierDocumentNumberKey: string;
    purchaseClassification: boolean;
  };

  withholding: { applies: boolean };

  taxes: { model: CountryTaxModel; nameKey: string };

  paymentMethods: {
    catalogue: PaymentMethodCatalogue;
    authority: string | null;
    defaults: readonly PaymentMethodSeed[];
  };

  payroll: {
    statutoryParameters: 'PLATFORM' | 'COMPANY';
    parameters: readonly PayrollParameterSeed[];
    concepts: readonly PayrollConceptSeed[];
  };

  /** The customer a sale names when it names nobody. */
  defaultCustomer: { nameKey: string };

  fiscalReturns: {
    generator: FiscalReturnGenerator | null;
    dueDay: number | null;
    prepareWith: readonly CountryPackReportLink[];
  };

  examples: CountryPackExamples;
}


function legacyPack(market: Market): CountryPack {
  return {
    countryCode: market.code,
    booksLanguage: market.profile?.booksLanguage ?? null,
    documents: {
      fiscalNumbering: market.documents.fiscalNumbering,
      supplierFiscalNumber: market.purchases.supplierFiscalNumber,
      supplierDocumentNumberKey: market.purchases.receivedDocument.labelKey,
      purchaseClassification: market.purchases.purchaseClassification,
    },
    withholding: { applies: market.taxes.withholding.applies },
    taxes: { model: market.taxes.model, nameKey: market.taxes.nameKey },
    paymentMethods: {
      catalogue: market.payments.catalogue,
      authority: market.payments.authority,
      defaults: market.payments.defaults,
    },
    payroll: {
      statutoryParameters: market.payroll.statutoryParameters,
      parameters: market.payroll.parameters,
      concepts: market.payroll.concepts,
    },
    defaultCustomer: { nameKey: market.documents.defaultCustomer.nameKey },
    fiscalReturns: {
      generator: market.returns.generator as FiscalReturnGenerator | null,
      dueDay: market.returns.dueDay,
      prepareWith: market.returns.prepareWith,
    },
    examples: market.profile ? { ...market.profile.examples } : { city: '', postalCode: null, phone: '' },
  };
}

export const COUNTRY_PACKS: Readonly<Record<string, CountryPack>> = Object.freeze(
  Object.fromEntries(allMarkets().map((market) => [market.code, legacyPack(market)])),
);

/**
 * The pack of a market. A market with no package — a tenant whose country was never set, or one the
 * product does not sell in — gets the neutral market's answers: nothing country-specific.
 */
export function countryPackFor(countryCode: string | null | undefined): CountryPack {
  return legacyPack(marketFor(countryCode));
}

/**
 * Every name a default customer has been seeded under, in every language, so a backfill can tell
 * the row provisioning created from one a person named.
 */
export const DEFAULT_CUSTOMER_NAME_KEYS: readonly string[] = [
  ...new Set(allMarkets().map((market) => market.documents.defaultCustomer.nameKey)),
];
