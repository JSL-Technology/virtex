import type { MarketReturnFiling, MarketReturnResult, ReturnDataset, ReturnPayslipRecord } from '../../contracts';
import { dgiiPeriod, money } from './formats';

/**
 * What the Tesorería de la Seguridad Social is told each month.
 *
 * Two declarations, and one file that carries the second to the TSS's own system:
 *
 * - **Novedades** — who joined, who left and whose salary changed in the period. Mid-period is the
 *   norm, not an edge: the proration in the payroll and these events are the two halves of handling
 *   it correctly.
 * - **Autodeterminación** — what each worker was paid and what each fund took from it, derived from
 *   the period's APPROVED payslips. Never from a parallel calculation: what is declared has to be
 *   what was paid, and the payslips are the rows the ledger was posted from.
 * - **SUIR** — the autodeterminación as the delimited file the TSS's system accepts.
 *
 * *Verificar con contabilidad/legal*: the exact byte layout the SUIR accepts must be validated
 * against the TSS's current schema before filing. Every figure and the structure are right; the
 * field order is the last mile that needs the authority's own spec, and it is isolated in
 * `suirLine`.
 */

/** The four SDSS funds, as the TSS's own file names them. */
const AFP = 'AFP';
const SFS = 'SFS';
const SRL = 'SRL';
const INFOTEP = 'INFOTEP';

export const novedades: MarketReturnFiling = {
  code: 'novedades',
  labelKey: 'returns.do.novedades',
  periodicity: 'MONTHLY',
  mediaType: 'text/plain; charset=utf-8',
  extension: 'txt',
  // Every employee, their NSS and their salary: the right to read a sales return is not the right
  // to read this.
  permission: 'payroll:view',
  // Declared when there is something to declare: a month with no movement owes no novedad, so a
  // calendar that showed eleven months «not filed» would be eleven months that were never due.
  tracked: false,
  async build(dataset: ReturnDataset) {
    const events = await dataset.employeeEvents();
    const rows = events.map((event) =>
      [
        KIND[event.kind],
        event.socialSecurityNumber ?? '',
        event.employeeName,
        event.effectiveDate.replace(/-/g, ''),
        event.salary === null ? '' : money(event.salary),
      ].join('|'),
    );
    const header = [
      '# Novedades TSS',
      `# Periodo: ${dgiiPeriod(dataset.period)}`,
      `# Registros: ${rows.length}`,
      '# Tipo|NSS|Nombre|Fecha|Salario',
    ].join('\n');
    return { file: `${header}\n${rows.join('\n')}\n`, records: rows.length };
  },
  fileName: (period) => `TSS_novedades_${dgiiPeriod(period)}.txt`,
};

/** `ALTA` an entry, `BAJA` a departure, `CAMBIO_SALARIO` a new salary: the TSS's own words. */
const KIND: Readonly<Record<'HIRE' | 'TERMINATION' | 'SALARY_CHANGE', string>> = {
  HIRE: 'ALTA',
  TERMINATION: 'BAJA',
  SALARY_CHANGE: 'CAMBIO_SALARIO',
};

export const suir: MarketReturnFiling = {
  code: 'suir',
  labelKey: 'returns.do.suir',
  periodicity: 'MONTHLY',
  mediaType: 'text/plain; charset=utf-8',
  extension: 'txt',
  tracked: true,
  permission: 'payroll:view',
  async build(dataset: ReturnDataset): Promise<MarketReturnResult> {
    const payslips = await dataset.payslips();
    if (!payslips.length) {
      // Nothing was approved for the period: there is no figure to declare, and declaring a
      // calculation nobody paid is the one thing this filing must never do.
      return { refusal: { messageKey: 'returns.do.tss_requires_approved_run' } };
    }

    const rows = payslips.map(suirLine);
    const header = [
      '# SUIR — Autodeterminación TSS',
      `# Periodo: ${dgiiPeriod(dataset.period)}`,
      `# Empleados: ${rows.length}`,
      '# NSS|Nombre|SalarioCotizable|AFP_Empleado|AFP_Empleador|SFS_Empleado|SFS_Empleador|SRL|INFOTEP',
    ].join('\n');
    return { file: `${header}\n${rows.join('\n')}\n`, records: rows.length };
  },
  fileName: (period) => `TSS_suir_${dgiiPeriod(period)}.txt`,
};

/** One employee's SUIR record. **Field order/format pending validation against the TSS schema.** */
function suirLine(payslip: ReturnPayslipRecord): string {
  return [
    payslip.socialSecurityNumber ?? '',
    payslip.employeeName,
    money(payslip.contributoryBase),
    money(share(payslip, AFP, 'employeeAmount')),
    money(share(payslip, AFP, 'employerAmount')),
    money(share(payslip, SFS, 'employeeAmount')),
    money(share(payslip, SFS, 'employerAmount')),
    money(share(payslip, SRL, 'employerAmount')),
    money(share(payslip, INFOTEP, 'employerAmount')),
  ].join('|');
}

/** One fund's share on a payslip, summed in case an adjustment carries the code twice. */
function share(payslip: ReturnPayslipRecord, code: string, side: 'employeeAmount' | 'employerAmount'): number {
  return payslip.contributions.filter((contribution) => contribution.code === code).reduce((sum, c) => sum + c[side], 0);
}
