import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConflictError, ForbiddenError, NotFoundError } from '../../i18n/localized.exception';
import { PayrollConcept } from '../entities/payroll-concept.entity';
import { CreateConceptDto } from '../dto/create-concept.dto';
import { UpdateConceptDto } from '../dto/update-concept.dto';

/**
 * The tenant's catalogue of payroll concepts — the configurable earnings, deductions and employer
 * costs the calculation consumes.
 *
 * Concepts are configuration, not code: "add a transport allowance", "start deducting a cooperative
 * saving", "this bonus is taxable but that one is not" are rows managed here, and the engine reads
 * them. System concepts (seeded, `isSystem`) cannot be deleted by a tenant because a run or an input
 * may reference them; they can be deactivated instead.
 */
@Injectable()
export class PayrollConceptService {
  constructor(
    @InjectRepository(PayrollConcept)
    private readonly concepts: Repository<PayrollConcept>,
  ) {}

  list(organizationId: string, includeInactive = false): Promise<PayrollConcept[]> {
    return this.concepts.find({
      where: includeInactive ? { organizationId } : { organizationId, active: true },
      order: { sortOrder: 'ASC', code: 'ASC' },
    });
  }

  async findOne(id: string, organizationId: string): Promise<PayrollConcept> {
    const concept = await this.concepts.findOne({ where: { id, organizationId } });
    if (!concept) throw new NotFoundError('PAYROLL.CONCEPTO_NO_ENCONTRADO', { id });
    return concept;
  }

  async create(dto: CreateConceptDto, organizationId: string): Promise<PayrollConcept> {
    const concept = this.concepts.create({ ...dto, organizationId, isSystem: false });
    try {
      return await this.concepts.save(concept);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictError('PAYROLL.YA_EXISTE_CONCEPTO_CON_ESE_CODIGO', { p1: dto.code });
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateConceptDto, organizationId: string): Promise<PayrollConcept> {
    const concept = await this.findOne(id, organizationId);
    return this.concepts.save(this.concepts.merge(concept, dto));
  }

  /** Delete a tenant-defined concept. A seeded system concept is deactivated, never removed. */
  async remove(id: string, organizationId: string): Promise<void> {
    const concept = await this.findOne(id, organizationId);
    if (concept.isSystem) {
      throw new ForbiddenError('PAYROLL.CONCEPTO_SISTEMA_NO_SE_ELIMINA_DESACTIVELO');
    }
    await this.concepts.delete({ id, organizationId });
  }
}
