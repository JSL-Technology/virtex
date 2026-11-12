// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketReturns, ReturnPreparationReport } from '../contracts';
import { preparationReport } from '../kit/returns';
import { notImplemented } from '../kit/coverage';

/** United States: sales tax by state, payments to contractors for the 1099s, the annual statements. */
const PREPARE_WITH: readonly ReturnPreparationReport[] = [
  preparationReport('localization.country_pack.reports.sales_invoices', '/invoices'),
  preparationReport('localization.country_pack.reports.general_ledger', '/accounting/general-ledger'),
  preparationReport('localization.country_pack.reports.supplier_payments', '/accounts-payable/payments'),
  preparationReport('localization.country_pack.reports.trial_balance', '/reports/financial-statements/trial-balance'),
  preparationReport('localization.country_pack.reports.income_statement', '/reports/financial-statements/income-statement'),
];
/** United States: the periodic returns its authority requires, and what the product files. */
export const returns: MarketReturns = {
  generator: null,
  dueDay: null,
  prepareWith: PREPARE_WITH,
  obligations: [],
  // No generator here: the product produces no return file for this market yet.
  filings: [],
  coverage: [
    { capability: 'periodicReturns', ...notImplemented('Formularios 1099 y declaraciones estatales') },
  ],
};
