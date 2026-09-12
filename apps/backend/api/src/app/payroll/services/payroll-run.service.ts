import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, LessThanOrEqual, Repository } from 'typeorm';
import { endOfMonthIso, monthBounds, monthsBetween, toIsoDate } from '../../common/dates';
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
import { PayrollConcept } from '../entities/payroll-concept.entity';
import { PayrollInput } from '../entities/payroll-input.entity';
import { JurisdictionRegistry } from '../jurisdictions/jurisdiction-registry';
import { PayrollParametersService } from './payroll-parameters.service';
import {
  ComputedPayslip,
  ConceptInput,
  EmployeeCalculationInput,
  PayrollCalculationService,
} from './payroll-calculation.service';
import { PayrollAccountingService } from './payroll-accounting.service';
import { SeveranceResult, SeveranceService } from './severance.service';

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
    @InjectRepository(PayrollConcept)
    private readonly concepts: Repository<PayrollConcept>,
    @InjectRepository(PayrollInput)
    private readonly inputs: Repository<PayrollInput>,
    private readonly dataSource: DataSource,
    private readonly parameters: PayrollParametersService,
    private readonly calculation: PayrollCalculationService,
    private readonly registry: JurisdictionRegistry,
    private readonly accounting: PayrollAccountingService,
    private readonly severance: SeveranceService,
  ) {}

  /**
   * A termination liquidation for an employee: preaviso, cesantía, vacaciones and regalía under the
   * Código de Trabajo, from the employee's hire date and the salary in force at the end date.
   */
  async previewSeverance(
    employeeId: string,
    organizationId: string,
    endDate: string,
    overrides: { monthlySalary?: number; ordinarySalaryEarnedThisYear?: number } = {},
  ): Promise<SeveranceResult> {
    const employee = await this.employees.findOne({ where: { id: employeeId, organizationId } });
    if (!employee) throw new NotFoundError('HCM.EMPLOYEE_NOT_FOUND', { id: employeeId });
    if (!employee.hireDate) {
      throw new BadRequestError('PAYROLL.EMPLEADO_SIN_FECHA_INGRESO_NO_LIQUIDABLE');
    }
    const end = toIsoDate(endDate);

    let monthlySalary = overrides.monthlySalary;
    if (monthlySalary == null) {
      const compensation = await this.compensationFor(
        this.dataSource.manager,
        employeeId,
        end,
        organizationId,
      );
      if (!compensation) {
        throw new BadRequestError('PAYROLL.EMPLEADO_SIN_COMPENSACION_NO_LIQUIDABLE');
      }
      monthlySalary = this.toMonthly(compensation);
    }

    return this.severance.computeTermination({
      monthlySalary,
      hireDate: employee.hireDate,
      endDate: end,
      ordinarySalaryEarnedThisYear: overrides.ordinarySalaryEarnedThisYear,
    });
  }

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

    // At most one REGULAR and one CHRISTMAS_BONUS run per period; adjustments are allowed on top and
    // reference the original. A partial unique index enforces the same at the database, so this check
    // is the friendly error and the index is the guarantee against a concurrent double-create.
    if (runType === PayrollRunType.REGULAR || runType === PayrollRunType.CHRISTMAS_BONUS) {
      const existing = await this.runs.findOne({
        where: {
          organizationId,
          periodYear: input.periodYear,
          periodMonth: input.periodMonth,
          runType,
        },
      });
      if (existing && existing.status !== PayrollRunStatus.CANCELLED) {
        throw new ConflictError('PAYROLL.YA_EXISTE_CORRIDA_PERIODO', {
          p1: `${runType} ${input.periodMonth}/${input.periodYear}`,
        });
      }
    }

    // An adjustment corrects a specific, already-approved run of the same period — validated here so
    // an adjustment can never dangle, cross a period, or claim to correct a run that never posted.
    if (runType === PayrollRunType.ADJUSTMENT) {
      await this.assertCorrectsAnApprovedRun(input, organizationId, country);
    }

    const run = this.runs.create({
      organizationId,
      name: input.name ?? this.defaultRunName(runType, input.periodMonth, input.periodYear),
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
    try {
      return await this.runs.save(run);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictError('PAYROLL.YA_EXISTE_CORRIDA_PERIODO', {
          p1: `${runType} ${input.periodMonth}/${input.periodYear}`,
        });
      }
      throw error;
    }
  }

  private defaultRunName(runType: PayrollRunType, month: number, year: number): string {
    const period = `${String(month).padStart(2, '0')}/${year}`;
    if (runType === PayrollRunType.CHRISTMAS_BONUS) return `Regalía pascual ${year}`;
    if (runType === PayrollRunType.ADJUSTMENT) return `Ajuste de nómina ${period}`;
    return `Nómina ${period}`;
  }

  /** An adjustment must name a run that is APPROVED/PAID, same tenant, country and period. */
  private async assertCorrectsAnApprovedRun(
    input: CreateRunInput,
    organizationId: string,
    country: string,
  ): Promise<void> {
    if (!input.correctsRunId) {
      throw new BadRequestError('PAYROLL.AJUSTE_REQUIERE_CORRIDA_A_CORREGIR');
    }
    const corrected = await this.runs.findOne({
      where: { id: input.correctsRunId, organizationId },
    });
    if (!corrected) {
      throw new NotFoundError('PAYROLL.CORRIDA_A_CORREGIR_NO_ENCONTRADA', { id: input.correctsRunId });
    }
    const committed =
      corrected.status === PayrollRunStatus.APPROVED || corrected.status === PayrollRunStatus.PAID;
    if (
      !committed ||
      corrected.periodYear !== input.periodYear ||
      corrected.periodMonth !== input.periodMonth ||
      corrected.countryCode !== country
    ) {
      throw new BadRequestError('PAYROLL.AJUSTE_CORRIGE_CORRIDA_APROBADA_MISMO_PERIODO');
    }
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

    // Concept catalogue and the run's variable inputs, loaded once and shared across employees.
    const conceptsByCode = new Map(
      (await this.concepts.find({ where: { organizationId, active: true } })).map((c) => [c.code, c]),
    );
    const inputsByEmployee = await this.loadInputsByEmployee(organizationId, runId);

    // For an adjustment, the payslips of the run being corrected — to diff against.
    const correctedByEmployee =
      run.runType === PayrollRunType.ADJUSTMENT && run.correctsRunId
        ? await this.loadCorrectedPayslips(organizationId, run.correctsRunId)
        : new Map<string, ComputedPayslip>();

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

        const compensation = await this.compensationFor(em, employee.id, run.periodEnd, organizationId);
        if (!compensation) {
          this.logger.warn(
            `Empleado ${employee.id} sin compensación vigente en ${run.periodEnd}; se omite.`,
          );
          continue;
        }

        const calcInput = this.toCalculationInput(
          employee,
          compensation,
          this.buildConceptInputs(inputsByEmployee.get(employee.id) ?? [], conceptsByCode),
        );

        let slip: ComputedPayslip;
        if (run.runType === PayrollRunType.CHRISTMAS_BONUS) {
          slip = this.calculation.calculateChristmasBonus(
            calcInput,
            this.christmasBonusAmount(employee, compensation, run.periodYear, run.periodEnd),
            params,
            strategy,
          );
        } else {
          slip = this.calculation.calculate(
            calcInput,
            { countryCode: run.countryCode, periodStart: run.periodStart, periodEnd: run.periodEnd },
            params,
            strategy,
          );
          if (run.runType === PayrollRunType.ADJUSTMENT) {
            // Only the difference against the corrected run is booked and declared, so approving an
            // adjustment never re-posts the whole planilla.
            slip = this.calculation.diff(slip, correctedByEmployee.get(employee.id) ?? this.zeroSlip(slip));
            if (this.calculation.isZeroPayslip(slip)) continue;
          }
        }

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
    if (!bankGlAccountId) {
      throw new BadRequestError('PAYROLL.PAGO_REQUIERE_CUENTA_BANCARIA');
    }
    return this.dataSource.transaction(async (em) => {
      const run = await em.findOne(PayrollRun, { where: { id: runId, organizationId } });
      if (!run) throw new NotFoundError('PAYROLL.CORRIDA_NO_ENCONTRADA', { id: runId });
      if (run.status !== PayrollRunStatus.APPROVED) {
        throw new ConflictError('PAYROLL.SOLO_CORRIDA_APROBADA_PUEDE_PAGARSE');
      }

      // The cash actually leaves here: DR net-wages-payable / CR bank, idempotent on the run, so an
      // approved run and a paid run cannot drift and the payable approval created is cleared.
      const paymentEntryId = await this.accounting.postPayment(
        em,
        run,
        bankGlAccountId,
        run.totalNet,
        { actorUserId, systemReason: 'payroll-payment' },
      );

      run.paymentJournalEntryId = paymentEntryId;
      run.status = PayrollRunStatus.PAID;
      run.paidAt = new Date();
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
    organizationId: string,
  ): Promise<EmployeeCompensation | null> {
    // Scoped by tenant as well as employee: an employee id is a uuid, but a payroll query is never
    // allowed to read a compensation row it did not stamp, so the tenant is on every clause.
    return em.findOne(EmployeeCompensation, {
      where: { organizationId, employeeId, effectiveFrom: LessThanOrEqual(on) },
      order: { effectiveFrom: 'DESC' },
    });
  }

  private toCalculationInput(
    employee: Employee,
    compensation: EmployeeCompensation,
    concepts: ConceptInput[],
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
      concepts,
    };
  }

  /** The run's inputs, grouped by employee, loaded once per calculation. */
  private async loadInputsByEmployee(
    organizationId: string,
    runId: string,
  ): Promise<Map<string, PayrollInput[]>> {
    const rows = await this.inputs.find({ where: { organizationId, runId } });
    const byEmployee = new Map<string, PayrollInput[]>();
    for (const row of rows) {
      const list = byEmployee.get(row.employeeId) ?? [];
      list.push(row);
      byEmployee.set(row.employeeId, list);
    }
    return byEmployee;
  }

  /** Turn this run's variable inputs into the engine's concept inputs, resolved against the catalogue. */
  private buildConceptInputs(
    inputs: PayrollInput[],
    conceptsByCode: Map<string, PayrollConcept>,
  ): ConceptInput[] {
    const built: ConceptInput[] = [];
    for (const input of inputs) {
      const concept = conceptsByCode.get(input.conceptCode);
      if (!concept) continue; // an input whose concept was deactivated is silently ignored
      built.push({
        code: concept.code,
        name: concept.name,
        type: concept.type,
        calculation: concept.calculation,
        taxable: concept.taxable,
        contributesToTss: concept.contributesToTss,
        amount: input.amount ?? undefined,
        rate: input.rate ?? concept.rate ?? undefined,
        quantity: input.quantity ?? undefined,
        sortOrder: concept.sortOrder,
      });
    }
    return built;
  }

  /** The approved run's payslips, keyed by employee, mapped into the engine's shape for diffing. */
  private async loadCorrectedPayslips(
    organizationId: string,
    correctsRunId: string,
  ): Promise<Map<string, ComputedPayslip>> {
    const slips = await this.payslips.find({ where: { organizationId, runId: correctsRunId } });
    return new Map(slips.map((s) => [s.employeeId, this.storedToComputed(s)]));
  }

  /** A stored payslip as the engine's {@link ComputedPayslip} — numeric fields only; lines are not diffed. */
  private storedToComputed(s: Payslip): ComputedPayslip {
    return {
      employeeId: s.employeeId,
      employeeName: s.employeeName,
      employeeIdentityMasked: s.employeeIdentityMasked,
      employeeTssNss: s.employeeTssNss,
      baseDays: s.baseDays,
      workedDays: s.workedDays,
      baseSalary: s.baseSalary,
      grossEarnings: s.grossEarnings,
      tssBase: s.tssBase,
      taxableBase: s.taxableBase,
      afpEmployee: s.afpEmployee,
      sfsEmployee: s.sfsEmployee,
      incomeTax: s.incomeTax,
      infotepEmployee: s.infotepEmployee,
      afpEmployer: s.afpEmployer,
      sfsEmployer: s.sfsEmployer,
      srlEmployer: s.srlEmployer,
      infotepEmployer: s.infotepEmployer,
      otherDeductions: s.otherDeductions,
      otherEmployerContributions: s.otherEmployerContributions,
      totalEmployeeDeductions: s.totalEmployeeDeductions,
      totalEmployerContributions: s.totalEmployerContributions,
      netPay: s.netPay,
      currencyCode: s.currencyCode,
      lines: [],
    };
  }

  /** A zero baseline for an employee who was absent from the corrected run (a new hire). */
  private zeroSlip(shape: ComputedPayslip): ComputedPayslip {
    return {
      ...shape,
      grossEarnings: 0,
      tssBase: 0,
      taxableBase: 0,
      afpEmployee: 0,
      sfsEmployee: 0,
      incomeTax: 0,
      infotepEmployee: 0,
      afpEmployer: 0,
      sfsEmployer: 0,
      srlEmployer: 0,
      infotepEmployer: 0,
      otherDeductions: 0,
      otherEmployerContributions: 0,
      totalEmployeeDeductions: 0,
      totalEmployerContributions: 0,
      netPay: 0,
    };
  }

  /**
   * The regalía pascual base: one twelfth of the ordinary salary earned in the calendar year.
   *
   * Approximated from the monthly salary and the months worked in the year up to the period — the
   * standard estimate when a full earnings history is not summed. Confirm against actual annual
   * ordinary earnings where those differ (variable pay, mid-year raises).
   */
  private christmasBonusAmount(
    employee: Employee,
    compensation: EmployeeCompensation,
    periodYear: number,
    periodEnd: string,
  ): number {
    const yearStart = `${periodYear}-01-01`;
    const start = employee.hireDate && employee.hireDate > yearStart ? employee.hireDate : yearStart;
    const monthsWorked = Math.max(0, Math.min(12, monthsBetween(start, periodEnd) + 1));
    return roundAmount((this.toMonthly(compensation) * monthsWorked) / 12);
  }

  /**
   * Normalise a base salary to a monthly figure.
   *
   * A run is a calendar month because AFP/SFS/ISR and the TSS filing are monthly, so a weekly or
   * biweekly *quoted* salary is converted to its monthly equivalent (52 or 26 pay periods a year over
   * 12 months) rather than run on its own cadence. The frequency describes how the amount is stated,
   * not a separate run schedule.
   */
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
      infotepEmployee: slip.infotepEmployee,
      afpEmployer: slip.afpEmployer,
      sfsEmployer: slip.sfsEmployer,
      srlEmployer: slip.srlEmployer,
      infotepEmployer: slip.infotepEmployer,
      otherDeductions: slip.otherDeductions,
      otherEmployerContributions: slip.otherEmployerContributions,
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
