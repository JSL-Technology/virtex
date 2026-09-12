import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { BadRequestError, ConflictError, NotFoundError } from '../../i18n/localized.exception';
import { Employee } from '../../hcm/entities/employee.entity';
import { PayrollConcept } from '../entities/payroll-concept.entity';
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
    if (!run) throw new NotFoundError('PAYROLL.CORRIDA_NO_ENCONTRADA', { id: runId });
    if (run.status !== PayrollRunStatus.DRAFT && run.status !== PayrollRunStatus.CALCULATED) {
      throw new ConflictError('PAYROLL.NOVEDADES_SOLO_EN_CORRIDA_EDITABLE');
    }

    await this.validateReferences(dto, organizationId);

    return this.dataSource.transaction(async (em) => {
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
        select: ['code'],
      });
      const known = new Set(found.map((c) => c.code));
      const missing = codes.filter((c) => !known.has(c));
      if (missing.length > 0) {
        throw new BadRequestError('PAYROLL.CONCEPTO_DESCONOCIDO_EN_NOVEDADES', {
          p1: missing.join(', '),
        });
      }
    }

    if (employeeIds.length > 0) {
      const count = await this.employees.count({
        where: { organizationId, id: In(employeeIds) },
      });
      if (count !== employeeIds.length) {
        throw new BadRequestError('PAYROLL.EMPLEADO_DESCONOCIDO_EN_NOVEDADES');
      }
    }
  }
}
