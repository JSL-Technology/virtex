import type { MarketPayroll } from '../contracts';
import { notImplemented } from './coverage';

/** A market whose statutory payroll the product does not compute, and seeds nothing for. */
export const PAYROLL_NOT_IMPLEMENTED: MarketPayroll = {
  statutoryParameters: 'COMPANY',
  parameters: [],
  concepts: [],
  coverage: notImplemented(),
};
