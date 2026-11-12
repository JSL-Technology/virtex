import type { MarketPayroll } from '../contracts';
import { notImplemented } from './coverage';

/** A market whose statutory payroll the product does not compute, and seeds nothing for. */
export const PAYROLL_NOT_IMPLEMENTED: MarketPayroll = {
  statutoryParameters: 'COMPANY',
  // No engine: a payroll run is refused here rather than computed under another country's law.
  engine: null,
  parameters: [],
  concepts: [],
  coverage: notImplemented(),
};
