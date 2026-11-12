import type { PayrollEngine } from '../contracts';
import { marketFor } from '../registry';

/**
 * The engine that computes a market's statutory payroll, or null where the product has none.
 *
 * The Dominican rules used to be a class in a `jurisdictions/` module of the core, registered there
 * by hand — the one place that knew which countries existed. A market declares its own engine now
 * (`markets/<cc>/payroll.ts`), so adding Colombia's is adding it to that package.
 */
export function payrollEngineFor(countryCode: string | null | undefined): PayrollEngine | null {
  return marketFor(countryCode).payroll.engine;
}

/** Whether the product computes this market's statutory payroll at all. */
export function computesPayroll(countryCode: string | null | undefined): boolean {
  return payrollEngineFor(countryCode) !== null;
}
