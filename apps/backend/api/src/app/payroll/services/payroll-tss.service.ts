import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { monthBounds } from '../../common/dates';
import { roundAmount, sumAmounts } from '../../common/money';
import { NotFoundError, ConflictError } from '../../i18n/localized.exception';
import { Employee } from '../../hcm/entities/employee.entity';
import { EmployeeCompensation } from '../../hcm/entities/employee-compensation.entity';
import { PayrollRun, PayrollRunStatus } from '../entities/payroll-run.entity';
import { Payslip } from '../entities/payslip.entity';

export interface TssNovedad {
  type: 'ALTA' | 'BAJA' | 'CAMBIO_SALARIO';
  employeeId: string;
  employeeName: string;
  tssNss: string | null;
  effectiveDate: string;
  detail: string;
}

export interface AutodeterminacionRow {
  tssNss: string | null;
  employeeName: string;
  salarioCotizable: number;
  afpEmployee: number;
  afpEmployer: number;
  sfsEmployee: number;
  sfsEmployer: number;
  srlEmployer: number;
  infotepEmployer: number;
}

export interface Autodeterminacion {
  period: string;
  runId: string;
  rows: AutodeterminacionRow[];
  totals: Omit<AutodeterminacionRow, 'tssNss' | 'employeeName'>;
}

/**
 * The TSS side of payroll: Novedades, Autodeterminación and the SUIR file.
 *
 * ## One source of truth
 *
 * The audit's consistency invariant is that what is declared to the TSS equals what was actually
 * paid. The only way to guarantee that is to derive the Autodeterminación **from the approved run's
 * payslips**, never from a parallel calculation — so this service reads `payslips`, which are the
 * same rows the ledger was posted from and the employee was paid from. A run that has not been
 * approved cannot be self-determined, because its figures are not yet committed.
 *
 * ## The SUIR file
 *
 * `exportSuir` renders the Autodeterminación as a delimited file. The **exact byte layout the TSS
 * SUIR system accepts must be validated against the official schema** before it is filed — a file
 * that "generates" but does not match the layout is rejected in production without any error here.
 * The structure and every figure are correct; the field order/format is the last mile that needs the
 * authority's current spec, and is intentionally isolated in {@link toSuirLine}.
 */
@Injectable()
export class PayrollTssService {
  constructor(
    @InjectRepository(PayrollRun) private readonly runs: Repository<PayrollRun>,
    @InjectRepository(Payslip) private readonly payslips: Repository<Payslip>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(EmployeeCompensation)
    private readonly compensations: Repository<EmployeeCompensation>,
  ) {}

  /**
   * The events the TSS must be told about for a period: hires, terminations and salary changes.
   *
   * Altas/bajas are keyed by the hire/termination dates falling inside the period; salary changes by
   * a compensation row whose `effectiveFrom` falls inside it. Mid-period is the norm, not an edge —
   * the proration in the calculation and these novedades are the two halves of handling it correctly.
   */
  async novedades(
    organizationId: string,
    year: number,
    month: number,
  ): Promise<TssNovedad[]> {
    const { from, to } = monthBounds(year, month);
    const novedades: TssNovedad[] = [];

    const hired = await this.employees.find({
      where: { organizationId, hireDate: Between(from, to) },
    });
    for (const e of hired) {
      novedades.push({
        type: 'ALTA',
        employeeId: e.id,
        employeeName: `${e.firstName} ${e.lastName}`.trim(),
        tssNss: e.tssNss ?? null,
        effectiveDate: e.hireDate,
        detail: 'Ingreso',
      });
    }

    const terminated = await this.employees.find({
      where: { organizationId, terminationDate: Between(from, to) },
    });
    for (const e of terminated) {
      novedades.push({
        type: 'BAJA',
        employeeId: e.id,
        employeeName: `${e.firstName} ${e.lastName}`.trim(),
        tssNss: e.tssNss ?? null,
        effectiveDate: e.terminationDate as string,
        detail: 'Salida',
      });
    }

    const salaryChanges = await this.compensations.find({
      where: { organizationId, effectiveFrom: Between(from, to) },
      relations: ['employee'],
    });
    for (const c of salaryChanges) {
      // The very first compensation row of a new hire is the alta, not a change.
      if (c.employee && c.effectiveFrom === c.employee.hireDate) continue;
      novedades.push({
        type: 'CAMBIO_SALARIO',
        employeeId: c.employeeId,
        employeeName: c.employee
          ? `${c.employee.firstName} ${c.employee.lastName}`.trim()
          : c.employeeId,
        tssNss: c.employee?.tssNss ?? null,
        effectiveDate: c.effectiveFrom,
        detail: `Nuevo salario ${c.baseSalary} ${c.currencyCode}`,
      });
    }

    return novedades.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  }

  /** The Autodeterminación for a run, derived from its payslips. The run must be approved. */
  async autodeterminacion(runId: string, organizationId: string): Promise<Autodeterminacion> {
    const run = await this.runs.findOne({ where: { id: runId, organizationId } });
    if (!run) throw new NotFoundError('PAYROLL.CORRIDA_NO_ENCONTRADA', { id: runId });
    if (run.status !== PayrollRunStatus.APPROVED && run.status !== PayrollRunStatus.PAID) {
      throw new ConflictError('PAYROLL.AUTODETERMINACION_REQUIERE_CORRIDA_APROBADA');
    }

    const slips = await this.payslips.find({ where: { organizationId, runId } });
    const rows: AutodeterminacionRow[] = slips.map((s) => ({
      tssNss: s.employeeTssNss,
      employeeName: s.employeeName,
      salarioCotizable: s.tssBase,
      afpEmployee: s.afpEmployee,
      afpEmployer: s.afpEmployer,
      sfsEmployee: s.sfsEmployee,
      sfsEmployer: s.sfsEmployer,
      srlEmployer: s.srlEmployer,
      infotepEmployer: s.infotepEmployer,
    }));

    return {
      period: `${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}`,
      runId: run.id,
      rows,
      totals: {
        salarioCotizable: sumAmounts(rows.map((r) => r.salarioCotizable)),
        afpEmployee: sumAmounts(rows.map((r) => r.afpEmployee)),
        afpEmployer: sumAmounts(rows.map((r) => r.afpEmployer)),
        sfsEmployee: sumAmounts(rows.map((r) => r.sfsEmployee)),
        sfsEmployer: sumAmounts(rows.map((r) => r.sfsEmployer)),
        srlEmployer: sumAmounts(rows.map((r) => r.srlEmployer)),
        infotepEmployer: sumAmounts(rows.map((r) => r.infotepEmployer)),
      },
    };
  }

  /**
   * The SUIR file for a run, as delimited text.
   *
   * Derived entirely from the Autodeterminación, so the file cannot disagree with what was paid.
   * The exact layout is isolated in {@link toSuirLine} and must be confirmed against the TSS spec.
   */
  async exportSuir(runId: string, organizationId: string): Promise<string> {
    const auto = await this.autodeterminacion(runId, organizationId);
    const header = [
      '# SUIR — Autodeterminación TSS',
      `# Periodo: ${auto.period}`,
      `# Empleados: ${auto.rows.length}`,
      '# NSS|Nombre|SalarioCotizable|AFP_Empleado|AFP_Empleador|SFS_Empleado|SFS_Empleador|SRL|INFOTEP',
    ].join('\n');
    const body = auto.rows.map((r) => this.toSuirLine(r)).join('\n');
    return `${header}\n${body}\n`;
  }

  /**
   * One employee's SUIR record. **Field order/format pending validation against the TSS schema.**
   */
  private toSuirLine(r: AutodeterminacionRow): string {
    const n = (v: number) => roundAmount(v).toFixed(2);
    return [
      r.tssNss ?? '',
      r.employeeName,
      n(r.salarioCotizable),
      n(r.afpEmployee),
      n(r.afpEmployer),
      n(r.sfsEmployee),
      n(r.sfsEmployer),
      n(r.srlEmployer),
      n(r.infotepEmployer),
    ].join('|');
  }
}
