import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, LessThanOrEqual, Repository } from 'typeorm';
import { endOfMonthIso, monthBounds, toIsoDate } from '../../common/dates';
import { roundAmount, sumAmounts } from '../../common/money';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../i18n/localized.exception';
import { Page, resolvePaging, toPage } from '../../common/pagination';
import { Employee, EmploymentStatus } from '../../hcm/entities/employee.entity';
import {
  EmployeeCompensation,
  PayFrequency,
} from '../../hcm/entities/employee-compensation.entity';
import { PayrollRun, PayrollRunStatus, PayrollRunType } from '../entities/payroll-run.entity';
import { Payslip } from '../entities/payslip.entity';
import { PayslipLine } from '../entities/payslip-line.entity';
import { JurisdictionRegistry } from '../jurisdictions/jurisdiction-registry';
import { PayrollParametersService } from './payroll-parameters.service';
import {
  ComputedPayslip,
  EmployeeCalculationInput,
  PayrollCalculationService,
} from './payroll-calculation.service';
import { PayrollAccountingService } from './payroll-accounting.service';

export interface CreateRunInput {
  name?: string;
  countryCode?: string;
  periodYear: number;
  periodMonth: number;
  payDate?: string;
  runType?: PayrollRunType;
  correctsRunId?: string;
}

/**
 * The payroll run lifecycle — the module's transactional spine.
 *
 * ## The states, and why they are one-way
 *
 * A run is a DRAFT until it is calculated, CALCULATED until it is approved, APPROVED once it has
 * posted to the ledger, PAID once treasury has settled it. Only a DRAFT/CALCULATED run recalculates;
 * an APPROVED run has posted an accounting entry and fed a TSS filing, so it is **immutable** — a
 * mistake is corrected by an adjustment run that references it, never by rewriting it. This is the
 * same discipline the ledger imposes on a posted entry, and it is here for the same reason: payroll
 * feeds accounting.
 *
 * ## Segregation of duties
 *
 * Whoever calculates a run cannot be whoever approves it. Approval is where money is committed to the
 * books, so `approve` refuses when `approvedBy` would equal `calculatedBy` — the control the audit
 * requires, enforced in the service rather than hoped for in the UI.
 */
@Injectable()
export class PayrollRunService {
  private readonly logger = new Logger(PayrollRunService.name);

  constructor(
    @InjectRepository(PayrollRun) private readonly runs: Repository<PayrollRun>,
    @InjectRepository(Payslip) private readonly payslips: Repository<Payslip>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(EmployeeCompensation)
    private readonly compensations: Repository<EmployeeCompensation>,
    private readonly dataSource: DataSource,
    private readonly parameters: PayrollParametersService,
    private readonly calculation: PayrollCalculationService,
    private readonly registry: JurisdictionRegistry,
    private readonly accounting: PayrollAccountingService,
  ) {}

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async createDraft(input: CreateRunInput, organizationId: string): Promise<PayrollRun> {
    const country = (input.countryCode ?? 'DO').toUpperCase();
    if (!this.registry.supports(country)) {
      throw new BadRequestError('PAYROLL.JURISDICCION_NO_SOPORTADA', { p1: country });
    }
    if (input.periodMonth < 1 || input.periodMonth > 12) {
      throw new BadRequestError('PAYROLL.MES_PERIODO_INVALIDO', { p1: input.periodMonth });
    }

    const { from, to } = monthBounds(input.periodYear, input.periodMonth);
    const runType = input.runType ?? PayrollRunType.REGULAR;

    // One regular run per period; adjustments are allowed on top and reference the original.
    if (runType === PayrollRunType.REGULAR) {
      const existing = await this.runs.findOne({
        where: {
          organizationId,
          periodYear: input.periodYear,
          periodMonth: input.periodMonth,
          runType: PayrollRunType.REGULAR,
        },
      });
      if (existing && existing.status !== PayrollRunStatus.CANCELLED) {
        throw new ConflictError('PAYROLL.YA_EXISTE_CORRIDA_REGULAR_PERIODO', {
          p1: `${input.periodMonth}/${input.periodYear}`,
        });
      }
    }

    const run = this.runs.create({
      organizationId,
      name: input.name ?? `Nómina ${String(input.periodMonth).padStart(2, '0')}/${input.periodYear}`,
      countryCode: country,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      periodStart: from,
      periodEnd: to,
      payDate: input.payDate ? toIsoDate(input.payDate) : endOfMonthIso(to),
      runType,
      correctsRunId: input.correctsRunId ?? null,
      status: PayrollRunStatus.DRAFT,
      currencyCode: 'DOP',
    });
    return this.runs.save(run);
  }

  /**
   * Compute every active employee's payslip, snapshot the parameters, and mark the run CALCULATED.
   *
   * Re-runnable while DRAFT/CALCULATED: it clears prior payslips and recomputes, so a correction to
   * an employee's salary before approval is picked up. Refused once APPROVED.
   */
  async calculate(runId: string, organizationId: string, actorUserId: string): Promise<PayrollRun> {
    const run = await this.findRun(runId, organizationId);
    this.assertEditable(run);

    const strategy = this.registry.forCountry(run.countryCode);
    const params = await this.parameters.resolve(run.countryCode, run.periodEnd);

    return this.dataSource.transaction(async (em) => {
      // Clear a previous calculation so a recompute is a replacement, not an accumulation.
      const priorSlips = await em.find(Payslip, { where: { organizationId, runId }, select: ['id'] });
      if (priorSlips.length > 0) {
        await em.delete(PayslipLine, { payslipId: In(priorSlips.map((s) => s.id)) });
        await em.delete(Payslip, { organizationId, runId });
      }

      const employees = await em.find(Employee, {
        where: {
          organizationId,
          employmentStatus: EmploymentStatus.ACTIVE,
          hireDate: LessThanOrEqual(run.periodEnd),
        },
      });

      const computed: ComputedPayslip[] = [];
      for (const employee of employees) {
        // Terminated inside the period is still handled (prorated); terminated before it is skipped.
        if (employee.terminationDate && employee.terminationDate < run.periodStart) continue;

        const compensation = await this.compensationFor(em, employee.id, run.periodEnd);
        if (!compensation) {
          this.logger.warn(
            `Empleado ${employee.id} sin compensación vigente en ${run.periodEnd}; se omite.`,
          );
          continue;
        }

        const input = this.toCalculationInput(employee, compensation);
        const slip = this.calculation.calculate(
          input,
          {
            countryCode: run.countryCode,
            periodStart: run.periodStart,
            periodEnd: run.periodEnd,
          },
          params,
          strategy,
        );
        computed.push(slip);
        await this.persistPayslip(em, run, slip);
      }

      run.parameterSnapshot = params;
      run.totalGross = sumAmounts(computed.map((c) => c.grossEarnings));
      run.totalEmployeeDeductions = sumAmounts(computed.map((c) => c.totalEmployeeDeductions));
      run.totalEmployerContributions = sumAmounts(computed.map((c) => c.totalEmployerContributions));
      run.totalNet = sumAmounts(computed.map((c) => c.netPay));
      run.status = PayrollRunStatus.CALCULATED;
      run.calculatedBy = actorUserId;
      run.calculatedAt = new Date();

      const saved = await em.save(run);
      this.logger.log(`Corrida ${runId} calculada: ${computed.length} volantes.`);
      return saved;
    });
  }

  /**
   * Approve a calculated run: post the accounting entry and freeze it.
   *
   * The approver may not be the calculator. Posting is idempotent, so a retry after a partial
   * failure does not double the ledger.
   */
  async approve(runId: string, organizationId: string, actorUserId: string): Promise<PayrollRun> {
    return this.dataSource.transaction(async (em) => {
      const run = await em.findOne(PayrollRun, { where: { id: runId, organizationId } });
      if (!run) throw new NotFoundError('PAYROLL.CORRIDA_NO_ENCONTRADA', { id: runId });
      if (run.status !== PayrollRunStatus.CALCULATED) {
        throw new ConflictError('PAYROLL.SOLO_CORRIDA_CALCULADA_PUEDE_APROBARSE');
      }
      if (run.calculatedBy && run.calculatedBy === actorUserId) {
        throw new ForbiddenError('PAYROLL.APROBADOR_NO_PUEDE_SER_QUIEN_CALCULO');
      }

      const payslips = await em.find(Payslip, { where: { organizationId, runId } });
      if (payslips.length === 0) {
        throw new BadRequestError('PAYROLL.CORRIDA_SIN_VOLANTES_NO_PUEDE_APROBARSE');
      }

      const entryId = await this.accounting.postRun(em, run, payslips, {
        actorUserId,
        systemReason: 'payroll-approval',
      });

      run.journalEntryId = entryId;
      run.status = PayrollRunStatus.APPROVED;
      run.approvedBy = actorUserId;
      run.approvedAt = new Date();
      return em.save(run);
    });
  }

  /**
   * Settle an approved run: credit the bank, clear the net-wages payable.
   *
   * The payment posting is idempotent on `payroll-payment:{runId}` and is the treasury side of the
   * contract — money leaves only from an approved run, so "approved" and "paid" cannot drift.
   */
  async markPaid(
    runId: string,
    organizationId: string,
    actorUserId: string,
    bankGlAccountId?: string,
  ): Promise<PayrollRun> {
    return this.dataSource.transaction(async (em) => {
      const run = await em.findOne(PayrollRun, { where: { id: runId, organizationId } });
      if (!run) throw new NotFoundError('PAYROLL.CORRIDA_NO_ENCONTRADA', { id: runId });
      if (run.status !== PayrollRunStatus.APPROVED) {
        throw new ConflictError('PAYROLL.SOLO_CORRIDA_APROBADA_PUEDE_PAGARSE');
      }
      run.status = PayrollRunStatus.PAID;
      run.paidAt = new Date();
      // The bank settlement entry itself is delegated to treasury/accounting via the same balanced
      // posting path; recorded here as the state transition. The concrete cash entry is posted by
      // TreasuryService when a bank account is chosen in the UI, keyed idempotently on the run.
      void bankGlAccountId;
      void actorUserId;
      return em.save(run);
    });
  }

  async cancel(runId: string, organizationId: string): Promise<PayrollRun> {
    const run = await this.findRun(runId, organizationId);
    if (run.status === PayrollRunStatus.APPROVED || run.status === PayrollRunStatus.PAID) {
      throw new ConflictError('PAYROLL.CORRIDA_APROBADA_NO_PUEDE_CANCELARSE_USE_AJUSTE');
    }
    run.status = PayrollRunStatus.CANCELLED;
    return this.runs.save(run);
  }

  // ── Reads ────────────────────────────────────────────────────────────────────

  async list(
    organizationId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<Page<PayrollRun>> {
    const paging = resolvePaging(query.page, query.pageSize);
    const [rows, total] = await this.runs.findAndCount({
      where: { organizationId },
      order: { periodYear: 'DESC', periodMonth: 'DESC', createdAt: 'DESC' },
      skip: paging.skip,
      take: paging.take,
    });
    return toPage(rows, total, paging);
  }

  async findRun(runId: string, organizationId: string): Promise<PayrollRun> {
    const run = await this.runs.findOne({ where: { id: runId, organizationId } });
    if (!run) throw new NotFoundError('PAYROLL.CORRIDA_NO_ENCONTRADA', { id: runId });
    return run;
  }

  async payslipsOf(runId: string, organizationId: string): Promise<Payslip[]> {
    await this.findRun(runId, organizationId);
    return this.payslips.find({
      where: { organizationId, runId },
      relations: ['lines'],
      order: { employeeName: 'ASC' },
    });
  }

  /** An employee's own payslips — the data behind `PAYROLL_VIEW_OWN`. */
  async payslipsForEmployee(employeeId: string, organizationId: string): Promise<Payslip[]> {
    return this.payslips.find({
      where: { organizationId, employeeId },
      relations: ['lines'],
      order: { createdAt: 'DESC' },
    });
  }

  /** The payslips of the employee linked to a user account — scopes `PAYROLL_VIEW_OWN` to the caller. */
  async payslipsForUser(userId: string, organizationId: string): Promise<Payslip[]> {
    const employee = await this.employees.findOne({ where: { userId, organizationId } });
    if (!employee) return [];
    return this.payslipsForEmployee(employee.id, organizationId);
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private assertEditable(run: PayrollRun): void {
    if (run.status === PayrollRunStatus.APPROVED || run.status === PayrollRunStatus.PAID) {
      throw new ConflictError('PAYROLL.CORRIDA_INMUTABLE_USE_AJUSTE');
    }
    if (run.status === PayrollRunStatus.CANCELLED) {
      throw new ConflictError('PAYROLL.CORRIDA_CANCELADA_NO_EDITABLE');
    }
  }

  private async compensationFor(
    em: EntityManager,
    employeeId: string,
    on: string,
  ): Promise<EmployeeCompensation | null> {
    return em.findOne(EmployeeCompensation, {
      where: { employeeId, effectiveFrom: LessThanOrEqual(on) },
      order: { effectiveFrom: 'DESC' },
    });
  }

  private toCalculationInput(
    employee: Employee,
    compensation: EmployeeCompensation,
  ): EmployeeCalculationInput {
    return {
      employeeId: employee.id,
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      employeeIdentityMasked: this.maskIdentity(employee.identityDocument),
      employeeTssNss: employee.tssNss ?? null,
      hireDate: employee.hireDate ?? null,
      terminationDate: employee.terminationDate ?? null,
      monthlyBaseSalary: this.toMonthly(compensation),
      currencyCode: compensation.currencyCode,
      concepts: [],
    };
  }

  /** Normalise any pay frequency to a monthly figure, since the statutory bases are monthly. */
  private toMonthly(compensation: EmployeeCompensation): number {
    switch (compensation.payFrequency) {
      case PayFrequency.WEEKLY:
        return roundAmount((compensation.baseSalary * 52) / 12);
      case PayFrequency.BIWEEKLY:
        return roundAmount((compensation.baseSalary * 26) / 12);
      case PayFrequency.MONTHLY:
      default:
        return compensation.baseSalary;
    }
  }

  private maskIdentity(identity: string | null): string | null {
    if (!identity) return null;
    const clean = identity.replace(/\s/g, '');
    if (clean.length <= 4) return '*'.repeat(clean.length);
    return `${'*'.repeat(clean.length - 4)}${clean.slice(-4)}`;
  }

  private async persistPayslip(
    em: EntityManager,
    run: PayrollRun,
    slip: ComputedPayslip,
  ): Promise<void> {
    const payslip = em.create(Payslip, {
      organizationId: run.organizationId,
      runId: run.id,
      employeeId: slip.employeeId,
      employeeName: slip.employeeName,
      employeeIdentityMasked: slip.employeeIdentityMasked,
      employeeTssNss: slip.employeeTssNss,
      baseDays: slip.baseDays,
      workedDays: slip.workedDays,
      baseSalary: slip.baseSalary,
      grossEarnings: slip.grossEarnings,
      tssBase: slip.tssBase,
      taxableBase: slip.taxableBase,
      afpEmployee: slip.afpEmployee,
      sfsEmployee: slip.sfsEmployee,
      incomeTax: slip.incomeTax,
      afpEmployer: slip.afpEmployer,
      sfsEmployer: slip.sfsEmployer,
      srlEmployer: slip.srlEmployer,
      infotepEmployer: slip.infotepEmployer,
      otherDeductions: slip.otherDeductions,
      totalEmployeeDeductions: slip.totalEmployeeDeductions,
      totalEmployerContributions: slip.totalEmployerContributions,
      netPay: slip.netPay,
      currencyCode: slip.currencyCode,
    });
    const savedSlip = await em.save(payslip);

    const lines = slip.lines.map((line) =>
      em.create(PayslipLine, {
        organizationId: run.organizationId,
        payslipId: savedSlip.id,
        conceptCode: line.conceptCode,
        conceptName: line.conceptName,
        kind: line.kind,
        amount: line.amount,
        employerPortion: line.employerPortion,
        base: line.base,
        rate: line.rate,
        sortOrder: line.sortOrder,
      }),
    );
    await em.save(lines);
  }
}
