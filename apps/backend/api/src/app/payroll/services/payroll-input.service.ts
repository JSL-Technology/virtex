import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { BadRequestError, ConflictError, NotFoundError } from '../../i18n/localized.exception';
import { Employee } from '../../hcm/entities/employee.entity';
import { ConceptCalculation, PayrollConcept } from '../entities/payroll-concept.entity';
import { CONCEPT_RATE_LIMIT } from '../dto/create-concept.dto';
import { PayrollInput } from '../entities/payroll-input.entity';
import { PayrollRun, PayrollRunStatus } from '../entities/payroll-run.entity';
import { UpsertInputsDto } from '../dto/upsert-inputs.dto';

/**
 * The per-run variable inputs (novedades): overtime hours, one-off bonuses, loan instalments.
 *
 * They are captured against a run before it is calculated and are part of it: an APPROVED run is
 * immutable, so its inputs can no longer be changed. Every code and every employee is validated to
 * belong to the tenant, so an input can never reference another company's employee or an unknown
 * concept. The whole set is replaced atomically, so a re-submission is the new truth, not an
 * accumulation.
 */
@Injectable()
export class PayrollInputService {
  constructor(
    @InjectRepository(PayrollInput) private readonly inputs: Repository<PayrollInput>,
    @InjectRepository(PayrollRun) private readonly runs: Repository<PayrollRun>,
    @InjectRepository(PayrollConcept) private readonly concepts: Repository<PayrollConcept>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    private readonly dataSource: DataSource,
  ) {}

  list(runId: string, organizationId: string): Promise<PayrollInput[]> {
    return this.inputs.find({
      where: { organizationId, runId },
      order: { employeeId: 'ASC', conceptCode: 'ASC' },
    });
  }

  /** Replace a run's inputs. Refused once the run is APPROVED/PAID/CANCELLED. */
  async replace(
    runId: string,
    dto: UpsertInputsDto,
    organizationId: string,
  ): Promise<PayrollInput[]> {
    const run = await this.runs.findOne({ where: { id: runId, organizationId } });
    if (!run) throw new NotFoundError('payroll.payroll_run_id_not_found', { id: runId });
    if (run.status !== PayrollRunStatus.DRAFT && run.status !== PayrollRunStatus.CALCULATED) {
      throw new ConflictError('payroll.inputs_can_only_changed_while_run');
    }

    await this.validateReferences(dto, organizationId);

    return this.dataSource.transaction(async (em) => {
      // Inputs change under the run's lock, and only while the run is still open (NOM-04).
      await em.query(`SELECT "id" FROM "payroll_runs" WHERE "id" = $1 AND "organization_id" = $2 FOR UPDATE`, [runId, organizationId]);
      const current = await em.findOne(PayrollRun, { where: { id: runId, organizationId }, select: ['id', 'status'] });
      if (!current || (current.status !== PayrollRunStatus.DRAFT && current.status !== PayrollRunStatus.CALCULATED)) {
        throw new ConflictError('payroll.inputs_can_only_changed_while_run');
      }
      await em.delete(PayrollInput, { organizationId, runId });
      if (dto.items.length === 0) return [];
      const rows = dto.items.map((item) =>
        em.create(PayrollInput, {
          organizationId,
          runId,
          employeeId: item.employeeId,
          conceptCode: item.conceptCode,
          amount: item.amount ?? null,
          quantity: item.quantity ?? null,
          rate: item.rate ?? null,
          note: item.note ?? null,
        }),
      );
      return em.save(rows);
    });
  }

  /** Every referenced concept and employee must exist in the tenant, or the whole batch is rejected. */
  private async validateReferences(dto: UpsertInputsDto, organizationId: string): Promise<void> {
    const codes = [...new Set(dto.items.map((i) => i.conceptCode))];
    const employeeIds = [...new Set(dto.items.map((i) => i.employeeId))];

    if (codes.length > 0) {
      const found = await this.concepts.find({
        where: { organizationId, code: In(codes), active: true },
        select: ['code', 'calculation'],
      });
      const known = new Map(found.map((c) => [c.code, c]));
      const missing = codes.filter((c) => !known.has(c));
      if (missing.length > 0) {
        throw new BadRequestError('payroll.unknown_concept_inputs_p1', {
          p1: missing.join(', '),
        });
      }
      for (const item of dto.items) assertInputFitsConcept(item, known.get(item.conceptCode)!);
    }

    if (employeeIds.length > 0) {
      const count = await this.employees.count({
        where: { organizationId, id: In(employeeIds) },
      });
      if (count !== employeeIds.length) {
        throw new BadRequestError('payroll.one_more_inputs_reference_employee_outside');
      }
    }
  }
}

/**
 * An input carries what its concept's calculation reads, and nothing else (audit 2026-11-07,
 * NOM-03, NOM-05): an amount for a FIXED concept, hours for an HOURLY one, at most a rate override
 * for a PERCENTAGE or HOURLY one — within the ceiling the concept itself has. A rate of 50 on a
 * commission concept used to pay 50 × the salary; a negative amount on a deduction raised the net.
 */
export function assertInputFitsConcept(
  item: { conceptCode: string; amount?: number | null; quantity?: number | null; rate?: number | null },
  concept: Pick<PayrollConcept, 'code' | 'calculation'>,
): void {
  const has = (value: number | null | undefined) => value !== undefined && value !== null;
  const refuse = (field: string) => {
    throw new BadRequestError('payroll.input_does_not_fit_concept', { concept: concept.code, field });
  };
  for (const field of ['amount', 'quantity', 'rate'] as const) {
    if (has(item[field]) && !(Number(item[field]) >= 0)) refuse(field);
  }
  switch (concept.calculation) {
    case ConceptCalculation.FIXED:
      if (has(item.quantity)) refuse('quantity');
      if (has(item.rate)) refuse('rate');
      break;
    case ConceptCalculation.HOURLY:
      if (has(item.amount)) refuse('amount');
      break;
    case ConceptCalculation.PERCENTAGE:
      if (has(item.amount)) refuse('amount');
      if (has(item.quantity)) refuse('quantity');
      break;
  }
  const limit = CONCEPT_RATE_LIMIT[concept.calculation];
  if (has(item.rate) && limit !== undefined && Number(item.rate) > limit) {
    throw new BadRequestError(
      concept.calculation === ConceptCalculation.PERCENTAGE ? 'payroll.concept_rate_is_a_fraction' : 'payroll.concept_multiplier_too_high',
      { concept: concept.code },
    );
  }
}
