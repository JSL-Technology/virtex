import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseRequisition } from './entities/purchase-requisition.entity';
import { CreatePurchaseRequisitionDto } from './dto/create-purchase-requisition.dto';
import { UpdatePurchaseRequisitionDto } from './dto/update-purchase-requisition.dto';
import { NotFoundError } from '../i18n/localized.exception';
import { Page, resolvePaging, toPage } from '../common/pagination';

/**
 * Purchase requisitions.
 *
 * The module declared its entities and nothing else. This is the tenant-scoped register. The
 * requester is stamped from the authenticated principal, never taken from the body — a requisition
 * that could name any user as its author is an approval trail that means nothing.
 */
@Injectable()
export class ProcurementService {
  constructor(
    @InjectRepository(PurchaseRequisition)
    private readonly requisitionRepository: Repository<PurchaseRequisition>,
  ) {}

  async findAll(
    organizationId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<Page<PurchaseRequisition>> {
    const paging = resolvePaging(query.page, query.pageSize);
    const [rows, total] = await this.requisitionRepository.findAndCount({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      skip: paging.skip,
      take: paging.take,
    });
    return toPage(rows, total, paging);
  }

  async findOne(id: string, organizationId: string): Promise<PurchaseRequisition> {
    const requisition = await this.requisitionRepository.findOne({
      where: { id, organizationId },
    });
    if (!requisition) {
      throw new NotFoundError('PROCUREMENT.REQUISITION_NOT_FOUND', { id });
    }
    return requisition;
  }

  create(
    dto: CreatePurchaseRequisitionDto,
    organizationId: string,
    requestedByUserId: string,
  ): Promise<PurchaseRequisition> {
    const requisition = this.requisitionRepository.create({
      ...dto,
      organizationId,
      requestedByUserId,
    });
    return this.requisitionRepository.save(requisition);
  }

  async update(
    id: string,
    dto: UpdatePurchaseRequisitionDto,
    organizationId: string,
  ): Promise<PurchaseRequisition> {
    const requisition = await this.findOne(id, organizationId);
    return this.requisitionRepository.save(
      this.requisitionRepository.merge(requisition, dto),
    );
  }

  async remove(id: string, organizationId: string): Promise<void> {
    await this.findOne(id, organizationId);
    await this.requisitionRepository.delete({ id, organizationId });
  }
}
