import type { MarketDefinition } from './contracts';
import { NEUTRAL_ACCOUNTING } from './kit/accounting';
import { implemented, notImplemented } from './kit/coverage';
import { NO_FISCAL_NUMBERING } from './kit/documents';
import { GENERIC_PAYMENT_METHODS } from './kit/payments';
import { PAYROLL_NOT_IMPLEMENTED } from './kit/payroll';
import { SUPPLIER_INVOICE_NUMBER } from './kit/purchases';
import { PREPARE_WITH_LEDGERS } from './kit/returns';

/**
 * What the product answers for a country it is not sold in — a tenant whose country was never set,
 * or a code no package declares.
 *
 * It claims nothing country-specific: no profile and no identity documents (there is no truthful
 * name, currency or time zone to give), internal numbering, no withholding, the generic payment
 * methods, editable; the ledgers as the way to prepare its returns. Neutral, not the first market's:
 * the failure this architecture exists to fix is precisely an unknown market inheriting another
 * country's answers.
 */
export type NeutralMarket = Omit<MarketDefinition, 'profile'> & { readonly profile: null };

/** Either a market the product sells in, or the neutral answer for one it does not. */
export type Market = MarketDefinition | NeutralMarket;

export function neutralMarket(code: string): NeutralMarket {
  return {
    code,
    profile: null,
    identity: { documents: [], checksums: {}, structuralChecks: [], fiscalFields: [], supranationalRegimeCodes: {} },
    taxes: {
      model: 'NATIONAL_RATES',
      nameKey: 'localization.country_pack.tax_name.vat',
      // The product's default language (`DEFAULT_LANGUAGE`), not any market's: there is none to ask.
      principalTaxName: 'Impuesto',
      // Nothing is seeded where nothing is known: the company enters its own taxes.
      scheme: { configurationRequired: true, taxes: [] },
      withholding: { applies: false, regimes: [], configurationRequired: false },
      serviceChargeRate: 0,
      coverage: { taxDetermination: notImplemented(), withholding: notImplemented() },
    },
    documents: {
      fiscalNumbering: false,
      types: [],
      cancellation: null,
      // No authority stands behind these documents, so no code explains a note.
      adjustmentCodes: null, counterpartyVerdictCodes: null,
      debitNotes: true,
      defaultCustomer: { nameKey: 'ledger.provisioning.final_consumer' },
      numbering: NO_FISCAL_NUMBERING,
    },
    purchases: { supplierFiscalNumber: false, purchaseClassification: false, receivedDocument: SUPPLIER_INVOICE_NUMBER, fiscalAttributes: [] },
    payments: { catalogue: 'EDITABLE', authority: null, defaults: GENERIC_PAYMENT_METHODS },
    accounting: NEUTRAL_ACCOUNTING,
    payroll: PAYROLL_NOT_IMPLEMENTED,
    returns: {
      generator: null,
      dueDay: null,
      prepareWith: PREPARE_WITH_LEDGERS,
      obligations: [],
    // A market with no package of its own files nothing: there is no authority to file to.
    filings: [],
      coverage: [{ capability: 'periodicReturns', ...notImplemented() }],
    },
    einvoicing: { required: false, regime: null, channel: null, signing: null,
      settingsFields: [],
      rangeSecret: null,
      coverage: notImplemented() },
  };
}

/** Bookkeeping works everywhere: it is the part of the product that is not country-specific. */
export const ACCOUNTING_COVERAGE = implemented('Contabilidad, inventario, compras, tesorería y reportes financieros');
