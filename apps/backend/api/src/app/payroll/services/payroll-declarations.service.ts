import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { monthBounds } from '../../common/dates';
import { roundAmount, sumAmounts } from '../../common/money';
import { BadRequestError, NotFoundError } from '../../i18n/localized.exception';
import { Employee } from '../../hcm/entities/employee.entity';
import { PayrollRun, PayrollRunStatus } from '../entities/payroll-run.entity';
import { Payslip } from '../entities/payslip.entity';

/** One employee's line of the IR-3. */
export interface Ir3Row {
  employeeId: string;
  employeeName: string;
  /** The cédula as recorded, digits only. Null when it was never captured — fix before filing. */
  identityDocument: string | null;
  grossEarnings: number;
  /** AFP + SFS the employee paid: deducted before ISR. */
  socialSecurity: number;
  taxableBase: number;
  incomeTax: number;
}

export interface Ir3Declaration {
  period: string;
  rows: Ir3Row[];
  totals: Omit<Ir3Row, 'employeeId' | 'employeeName' | 'identityDocument'> & { employees: number };
  /** Employees whose cédula is missing: the DGII rejects the line. */
  missingIdentity: number;
  runs: string[];
}

/** One transfer of the payroll bank file. */
export interface PayrollTransfer {
  employeeName: string;
  identityDocument: string | null;
  bankName: string | null;
  accountNumber: string | null;
  /** `AHORRO` or `CORRIENTE`, as the bank portals name them. */
  accountType: string;
  amount: number;
}

/**
 * The bank file layouts. Each Dominican bank publishes its own template for payroll uploads and
 * revises it; the column ORDER and delimiter are isolated here so a change is one line.
 *
 * *Verificar con el banco:* `GENERIC` is a delimited file every bank's portal can map on upload.
 * The bank-specific orders follow the templates as commonly published; confirm against the current
 * template in the company's online-banking portal before the first upload.
 */
const LAYOUTS: Record<string, { delimiter: string; header: boolean; columns: Array<keyof PayrollTransfer | 'reference'> }> = {
  GENERIC: {
    delimiter: ',',
    header: true,
    columns: ['identityDocument', 'employeeName', 'bankName', 'accountType', 'accountNumber', 'amount', 'reference'],
  },
  BANRESERVAS: {
    delimiter: ';',
    header: false,
    columns: ['accountNumber', 'accountType', 'amount', 'identityDocument', 'employeeName', 'reference'],
  },
  POPULAR: {
    delimiter: ',',
    header: false,
    columns: ['accountNumber', 'amount', 'identityDocument', 'employeeName', 'accountType', 'reference'],
  },
  BHD: {
    delimiter: '|',
    header: false,
    columns: ['identityDocument', 'employeeName', 'accountNumber', 'accountType', 'amount', 'reference'],
  },
};

export const PAYROLL_BANK_LAYOUTS = Object.keys(LAYOUTS);

/**
 * What payroll declares and pays outside the ledger: the IR-3 (ISR withheld from salaries) and the
 * file the bank pays the wages from.
 *
 * Both read the approved run's payslips — the same rows the ledger was posted from and the TSS was
 * declared from — so what is declared to the DGII, paid by the bank and reported to the TSS is one
 * set of figures.
 */
@Injectable()
export class PayrollDeclarationsService {
  constructor(
    @InjectRepository(PayrollRun) private readonly runs: Repository<PayrollRun>,
    @InjectRepository(Payslip) private readonly payslips: Repository<Payslip>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
  ) {}

  /**
   * The IR-3 of a month: ISR withheld on the salaries PAID in it (by pay date), employee by employee.
   * Only approved or paid runs count — a calculated run is a draft of figures, not a payment.
   */
  async ir3(organizationId: string, year: number, month: number): Promise<Ir3Declaration> {
    const { from, to } = monthBounds(year, month);
    const runs = await this.runs.find({
      where: {
        organizationId,
        payDate: Between(from, to),
        status: In([PayrollRunStatus.APPROVED, PayrollRunStatus.PAID]),
      },
      select: ['id', 'name'],
    });
    const slips = runs.length
      ? await this.payslips.find({ where: { organizationId, runId: In(runs.map((r) => r.id)) } })
      : [];
    const employees = await this.employeesById(organizationId, slips.map((s) => s.employeeId));

    const byEmployee = new Map<string, Ir3Row>();
    for (const slip of slips) {
      const row = byEmployee.get(slip.employeeId) ?? {
        employeeId: slip.employeeId,
        employeeName: slip.employeeName,
        identityDocument: digits(employees.get(slip.employeeId)?.identityDocument),
        grossEarnings: 0,
        socialSecurity: 0,
        taxableBase: 0,
        incomeTax: 0,
      };
      row.grossEarnings = roundAmount(row.grossEarnings + Number(slip.grossEarnings));
      row.socialSecurity = roundAmount(row.socialSecurity + Number(slip.afpEmployee) + Number(slip.sfsEmployee));
      row.taxableBase = roundAmount(row.taxableBase + Number(slip.taxableBase));
      row.incomeTax = roundAmount(row.incomeTax + Number(slip.incomeTax));
      byEmployee.set(slip.employeeId, row);
    }
    const rows = [...byEmployee.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    return {
      period: `${year}${String(month).padStart(2, '0')}`,
      rows,
      totals: {
        employees: rows.length,
        grossEarnings: sumAmounts(rows.map((r) => r.grossEarnings)),
        socialSecurity: sumAmounts(rows.map((r) => r.socialSecurity)),
        taxableBase: sumAmounts(rows.map((r) => r.taxableBase)),
        incomeTax: sumAmounts(rows.map((r) => r.incomeTax)),
      },
      missingIdentity: rows.filter((r) => !r.identityDocument).length,
      runs: runs.map((r) => r.name),
    };
  }

  /**
   * The bank file that pays an approved run's net wages, in the bank's layout. Employees without a
   * bank account are left out and named, so they are paid another way rather than silently skipped.
   */
  async bankFile(
    organizationId: string,
    runId: string,
    layout = 'GENERIC',
  ): Promise<{ fileName: string; body: string; transfers: number; total: number; withoutAccount: string[] }> {
    const format = LAYOUTS[layout.toUpperCase()];
    if (!format) throw new BadRequestError('payroll.bank_file.layout_unknown', { layout });
    const run = await this.runs.findOne({ where: { id: runId, organizationId } });
    if (!run) throw new NotFoundError('payroll.run_not_found');
    if (run.status !== PayrollRunStatus.APPROVED && run.status !== PayrollRunStatus.PAID) {
      throw new BadRequestError('payroll.bank_file.run_not_approved');
    }
    const slips = await this.payslips.find({ where: { organizationId, runId } });
    const employees = await this.employeesById(organizationId, slips.map((s) => s.employeeId));

    const transfers: PayrollTransfer[] = [];
    const withoutAccount: string[] = [];
    for (const slip of slips) {
      if (Number(slip.netPay) <= 0) continue;
      const employee = employees.get(slip.employeeId);
      if (!employee?.bankAccountNumber) {
        withoutAccount.push(slip.employeeName);
        continue;
      }
      transfers.push({
        employeeName: slip.employeeName,
        identityDocument: digits(employee.identityDocument),
        bankName: employee.bankName,
        accountNumber: employee.bankAccountNumber.replace(/\s|-/g, ''),
        accountType: /ahorr|saving/i.test(employee.bankAccountType ?? '') ? 'AHORRO' : 'CORRIENTE',
        amount: roundAmount(Number(slip.netPay)),
      });
    }
    const reference = `NOMINA ${run.periodYear}${String(run.periodMonth).padStart(2, '0')}`;
    const lines = transfers.map((t) =>
      format.columns
        .map((column) => cell(column === 'reference' ? reference : column === 'amount' ? t.amount.toFixed(2) : (t[column] ?? ''), format.delimiter))
        .join(format.delimiter),
    );
    if (format.header) lines.unshift(format.columns.join(format.delimiter));
    return {
      fileName: `NOMINA_${layout.toUpperCase()}_${run.periodYear}${String(run.periodMonth).padStart(2, '0')}.${format.delimiter === ',' ? 'csv' : 'txt'}`,
      body: lines.join('\r\n'),
      transfers: transfers.length,
      total: sumAmounts(transfers.map((t) => t.amount)),
      withoutAccount,
    };
  }

  private async employeesById(organizationId: string, ids: string[]): Promise<Map<string, Employee>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.employees.find({ where: { organizationId, id: In(unique) } });
    return new Map(rows.map((e) => [e.id, e]));
  }
}

function digits(value: string | null | undefined): string | null {
  const only = (value ?? '').replace(/\D/g, '');
  return only || null;
}

function cell(value: string | number, delimiter: string): string {
  const text = String(value).replace(/[\r\n]+/g, ' ');
  if (delimiter === ',' && /[",]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text.split(delimiter).join(' ');
}
