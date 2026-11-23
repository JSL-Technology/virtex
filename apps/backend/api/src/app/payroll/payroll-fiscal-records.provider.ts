import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import {
  PayrollFiscalEvent,
  PayrollFiscalPayslip,
  PayrollFiscalQuery,
  PayrollFiscalRecordsSource,
} from '../contracts/fiscal-records/payroll-fiscal-records.contract';
import { PayrollFiscalRecordsRegistry } from '../contracts/fiscal-records/payroll-fiscal-records.registry';
import { Employee } from '../hcm/entities/employee.entity';
import { EmployeeCompensation } from '../hcm/entities/employee-compensation.entity';
import { PayrollRun, PayrollRunStatus } from './entities/payroll-run.entity';
import { Payslip } from './entities/payslip.entity';

/** Only what was approved is declared: a run still being calculated is not what anybody was paid. */
const DECLARABLE = [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID];

/**
 * What payroll tells a social-security filing: the period's approved payslips with each fund's
 * share, and the hires, terminations and salary changes of the period.
 *
 * See `PayrollFiscalRecordsSource`. The Dominican autodeterminación used to be a service of this
 * module with its own HTTP routes, so a filing lived in payroll and knew the names of four funds;
 * the filing is now its market's (`markets/do/returns/`) and this answers the question it asks.
 */
@Injectable()
export class PayrollFiscalRecordsProvider implements PayrollFiscalRecordsSource, OnModuleInit {
  readonly sourceName = 'payroll';

  constructor(
    @InjectRepository(PayrollRun) private readonly runs: Repository<PayrollRun>,
    @InjectRepository(Payslip) private readonly payslipRepository: Repository<Payslip>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(EmployeeCompensation)
    private readonly compensations: Repository<EmployeeCompensation>,
    private readonly registry: PayrollFiscalRecordsRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * The payslips of every approved run of the period.
   *
   * Derived from the payslips themselves — the same rows the ledger was posted from and the
   * employee was paid from — so what is declared cannot disagree with what was paid. An adjustment
   * run approved in the period is part of it, because it is part of what was paid.
   */
  async payslips(query: PayrollFiscalQuery): Promise<PayrollFiscalPayslip[]> {
    const runs = await this.runs.find({
      where: {
        organizationId: query.organizationId,
        periodYear: query.year,
        periodMonth: query.month,
        status: In(DECLARABLE),
      },
      select: ['id'],
    });
    if (!runs.length) return [];

    const slips = await this.payslipRepository.find({
      where: { organizationId: query.organizationId, runId: In(runs.map((run) => run.id)) },
      order: { employeeName: 'ASC' },
    });

    return slips.map((slip) => ({
      employeeName: slip.employeeName,
      socialSecurityNumber: slip.employeeSocialSecurityNumber ?? null,
      contributoryBase: Number(slip.contributoryBase ?? 0),
      contributions: (slip.statutoryContributions ?? []).map((contribution) => ({
        code: contribution.code,
        employeeAmount: Number(contribution.employeeAmount ?? 0),
        employerAmount: Number(contribution.employerAmount ?? 0),
      })),
    }));
  }

  /**
   * Who joined, left or changed salary in the period.
   *
   * Mid-period is the norm, not an edge: the proration in the calculation and these events are the
   * two halves of handling it correctly.
   */
  async events(query: PayrollFiscalQuery): Promise<PayrollFiscalEvent[]> {
    const { organizationId, from, to } = query;
    const [hired, terminated, salaryChanges] = await Promise.all([
      this.employees.find({ where: { organizationId, hireDate: Between(from, to) } }),
      this.employees.find({ where: { organizationId, terminationDate: Between(from, to) } }),
      this.compensations.find({
        where: { organizationId, effectiveFrom: Between(from, to) },
        relations: ['employee'],
      }),
    ]);

    const events: PayrollFiscalEvent[] = [
      ...hired.map((employee) => event('HIRE', employee, employee.hireDate)),
      ...terminated.map((employee) => event('TERMINATION', employee, employee.terminationDate as string)),
      ...salaryChanges
        // The very first compensation row of a new hire is the hire, not a change.
        .filter((row) => !row.employee || row.effectiveFrom !== row.employee.hireDate)
        .map((row) => ({
          kind: 'SALARY_CHANGE' as const,
          employeeName: row.employee ? fullName(row.employee) : row.employeeId,
          socialSecurityNumber: row.employee?.socialSecurityNumber ?? null,
          effectiveDate: row.effectiveFrom,
          salary: Number(row.baseSalary ?? 0),
          currencyCode: row.currencyCode ?? null,
        })),
    ];

    return events.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  }
}

function event(kind: 'HIRE' | 'TERMINATION', employee: Employee, effectiveDate: string): PayrollFiscalEvent {
  return {
    kind,
    employeeName: fullName(employee),
    socialSecurityNumber: employee.socialSecurityNumber ?? null,
    effectiveDate,
    salary: null,
    currencyCode: null,
  };
}

function fullName(employee: Pick<Employee, 'firstName' | 'lastName'>): string {
  return `${employee.firstName} ${employee.lastName}`.trim();
}
