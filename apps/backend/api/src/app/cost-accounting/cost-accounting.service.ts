import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CostCenter } from './entities/cost-center.entity';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto';
import { NotFoundError } from '../i18n/localized.exception';

/**
 * The cost- and profit-centre register.
 *
 * The module existed as a lone entity with no service and no controller, so the register was a
 * table with no way to read or write it. This is the tenant-scoped CRUD the rest of the product
 * already has for its master data. Analytical postings classify against these centres; keeping the
 * register per tenant is why every query here carries `organizationId`.
 */
@Injectable()
export class CostAccountingService {
  constructor(
    @InjectRepository(CostCenter)
    private readonly costCenterRepository: Repository<CostCenter>,
  ) {}

  findAll(organizationId: string): Promise<CostCenter[]> {
    return this.costCenterRepository.find({
      where: { organizationId },
      order: { code: 'ASC' },
    });
  }

  async findOne(id: string, organizationId: string): Promise<CostCenter> {
    const costCenter = await this.costCenterRepository.findOne({
      where: { id, organizationId },
    });
    if (!costCenter) {
      throw new NotFoundError('COST_ACCOUNTING.COST_CENTER_NOT_FOUND', { id });
    }
    return costCenter;
  }

  create(dto: CreateCostCenterDto, organizationId: string): Promise<CostCenter> {
    const costCenter = this.costCenterRepository.create({ ...dto, organizationId });
    return this.costCenterRepository.save(costCenter);
  }

  async update(
    id: string,
    dto: UpdateCostCenterDto,
    organizationId: string,
  ): Promise<CostCenter> {
    const costCenter = await this.findOne(id, organizationId);
    return this.costCenterRepository.save(
      this.costCenterRepository.merge(costCenter, dto),
    );
  }

  async remove(id: string, organizationId: string): Promise<void> {
    await this.findOne(id, organizationId);
    await this.costCenterRepository.delete({ id, organizationId });
  }
}
