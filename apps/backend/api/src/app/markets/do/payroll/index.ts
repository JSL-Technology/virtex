import type { PayrollEngine } from '../../contracts';
import { DominicanPayrollEngine } from './engine';

/** The Dominican payroll engine: SDSS contributions and the DGII's salaried income-tax scale. */
export const payrollEngine: PayrollEngine = new DominicanPayrollEngine();

export { DominicanPayrollEngine, DO_CONTRIBUTION } from './engine';
