import type { ReturnPreparationReport } from '../contracts';

/** A report a return is prepared from. */
export const preparationReport = (labelKey: string, route: string): ReturnPreparationReport => ({ labelKey, route });

/**
 * Where a market has no return generator, the reports its returns are prepared from: the sales and
 * purchase registers for the consumption-tax return, the ledger for the tax accounts' balances, the
 * trial balance and income statement for the annual return.
 */
export const PREPARE_WITH_LEDGERS: readonly ReturnPreparationReport[] = [
  preparationReport('localization.country_pack.reports.sales_invoices', '/invoices'),
  preparationReport('localization.country_pack.reports.vendor_bills', '/accounts-payable'),
  preparationReport('localization.country_pack.reports.general_ledger', '/accounting/general-ledger'),
  preparationReport('localization.country_pack.reports.trial_balance', '/reports/financial-statements/trial-balance'),
  preparationReport('localization.country_pack.reports.income_statement', '/reports/financial-statements/income-statement'),
];
