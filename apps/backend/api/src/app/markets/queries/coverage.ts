import type { CapabilityCoverage, MarketCoverage } from '../contracts';
import { ACCOUNTING_COVERAGE } from '../neutral';
import { marketFor } from '../registry';
import { cancellationCoverageFor, fiscalAuthorityOf } from './documents';

/**
 * What the product does in a market, per capability, composed from what each of the market's files
 * declares about its own capability — never from a table kept beside them.
 *
 * The order is the reading order of the disclosure: bookkeeping, then the market's tax, its
 * electronic documents, its returns, its withholding and its payroll, then what may be done with an
 * issued document.
 */
export function coverageFor(countryCode: string | null | undefined): MarketCoverage {
  const market = marketFor(countryCode);
  const cancellation = cancellationCoverageFor(market.code);
  const lines: CapabilityCoverage[] = [
    { capability: 'accounting', ...ACCOUNTING_COVERAGE },
    { capability: 'taxDetermination', ...market.taxes.coverage.taxDetermination },
    { capability: 'electronicInvoicing', ...market.einvoicing.coverage },
    ...market.returns.coverage,
    { capability: 'withholding', ...market.taxes.coverage.withholding },
    { capability: 'payroll', ...market.payroll.coverage },
    market.documents.debitNotes
      ? { capability: 'debitNotes', level: 'implemented' }
      : { capability: 'debitNotes', level: 'not-implemented', detail: fiscalAuthorityOf(market.code) },
    cancellation.implemented
      ? { capability: 'documentCancellation', level: 'implemented', detail: cancellation.detail }
      : { capability: 'documentCancellation', level: 'not-implemented', detail: cancellation.detail },
  ];
  return { countryCode: market.code, capabilities: lines };
}

/** True when the product computes the market's statutory payroll. */
export function payrollImplemented(countryCode: string | null | undefined): boolean {
  return marketFor(countryCode).payroll.coverage.level === 'implemented';
}
