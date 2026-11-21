// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketPayroll } from '../contracts';
import { PAYROLL_NOT_IMPLEMENTED } from '../kit/payroll';

/** Peru: the product does not compute the statutory payroll yet, and seeds nothing for it. */
export const payroll: MarketPayroll = PAYROLL_NOT_IMPLEMENTED;
