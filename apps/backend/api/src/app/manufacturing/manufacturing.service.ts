import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductionOrder } from './entities/production-order.entity';
import { BillOfMaterial } from './entities/bill-of-material.entity';
import { BillOfMaterialItem } from './entities/bill-of-material-item.entity';
import { WorkCenter } from './entities/work-center.entity';
import { CreateProductionOrderDto } from './dto/create-production-order.dto';
import { UpdateProductionOrderDto } from './dto/update-production-order.dto';
import { CreateWorkCenterDto } from './dto/create-work-center.dto';
import { UpdateWorkCenterDto } from './dto/update-work-center.dto';
import { CreateBillOfMaterialDto } from './dto/create-bill-of-material.dto';
import { UpdateBillOfMaterialDto } from './dto/update-bill-of-material.dto';
import { NotFoundError } from '../i18n/localized.exception';
import { Page, resolvePaging, toPage } from '../common/pagination';

/**
 * Manufacturing master data and production orders.
 *
 * ## Why every method takes the tenant
 *
 * This service used to be `findAllOrders() { return this.repo.find(); }` and
 * `createOrder(data: any) { return this.repo.save(data); }`. The first returned **every tenant's**
 * production orders to any authenticated user holding `manufacturing:view` — a cross-tenant read,
 * and the only `Repository.find()` in the backend over a tenant-scoped table with no `where`. The
 * second saved an unvalidated body verbatim, so the caller chose the `organizationId`.
 *
 * Every query here is now scoped by `organizationId`, the tenant is stamped server-side from the
 * authenticated principal and never read from the request, and reads are paginated. This mirrors
 * the pattern every other tenant-scoped module in the product already follows (see `TaxesService`).
 */
@Injectable()
export class ManufacturingService {
  constructor(
    @InjectRepository(ProductionOrder)
    private readonly productionOrderRepository: Repository<ProductionOrder>,
    @InjectRepository(BillOfMaterial)
    private readonly bomRepository: Repository<BillOfMaterial>,
    @InjectRepository(BillOfMaterialItem)
    private readonly bomItemRepository: Repository<BillOfMaterialItem>,
    @InjectRepository(WorkCenter)
    private readonly workCenterRepository: Repository<WorkCenter>,
  ) {}

  // ── Production orders ────────────────────────────────────────────────────────

  async findAllOrders(
    organizationId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<Page<ProductionOrder>> {
    const paging = resolvePaging(query.page, query.pageSize);
    const [rows, total] = await this.productionOrderRepository.findAndCount({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      skip: paging.skip,
      take: paging.take,
    });
    return toPage(rows, total, paging);
  }

  async findOneOrder(id: string, organizationId: string): Promise<ProductionOrder> {
    const order = await this.productionOrderRepository.findOne({
      where: { id, organizationId },
    });
    if (!order) {
      throw new NotFoundError('MANUFACTURING.PRODUCTION_ORDER_NOT_FOUND', { id });
    }
    return order;
  }

  createOrder(
    dto: CreateProductionOrderDto,
    organizationId: string,
  ): Promise<ProductionOrder> {
    const order = this.productionOrderRepository.create({ ...dto, organizationId });
    return this.productionOrderRepository.save(order);
  }

  async updateOrder(
    id: string,
    dto: UpdateProductionOrderDto,
    organizationId: string,
  ): Promise<ProductionOrder> {
    const order = await this.findOneOrder(id, organizationId);
    return this.productionOrderRepository.save(
      this.productionOrderRepository.merge(order, dto),
    );
  }

  async removeOrder(id: string, organizationId: string): Promise<void> {
    await this.findOneOrder(id, organizationId);
    await this.productionOrderRepository.delete({ id, organizationId });
  }

  // ── Bills of materials ───────────────────────────────────────────────────────

  async findAllBoms(
    organizationId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<Page<BillOfMaterial>> {
    const paging = resolvePaging(query.page, query.pageSize);
    const [rows, total] = await this.bomRepository.findAndCount({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      skip: paging.skip,
      take: paging.take,
    });
    return toPage(rows, total, paging);
  }

  async findOneBom(id: string, organizationId: string): Promise<BillOfMaterial> {
    const bom = await this.bomRepository.findOne({
      where: { id, organizationId },
      relations: ['items'],
    });
    if (!bom) {
      throw new NotFoundError('MANUFACTURING.BILL_OF_MATERIAL_NOT_FOUND', { id });
    }
    return bom;
  }

  createBom(dto: CreateBillOfMaterialDto, organizationId: string): Promise<BillOfMaterial> {
    const { items, ...rest } = dto;
    const bom = this.bomRepository.create({
      ...rest,
      organizationId,
      // Items carry the tenant too, so a later direct query on them isolates correctly.
      items: (items ?? []).map((item) =>
        this.bomItemRepository.create({ ...item, organizationId }),
      ),
    });
    return this.bomRepository.save(bom);
  }

  async updateBom(
    id: string,
    dto: UpdateBillOfMaterialDto,
    organizationId: string,
  ): Promise<BillOfMaterial> {
    const bom = await this.findOneBom(id, organizationId);
    const { items, ...rest } = dto;
    this.bomRepository.merge(bom, rest);
    if (items) {
      // Replace the item set wholesale: a BOM is edited as a document, and `cascade` on the
      // relation removes the orphans left behind.
      bom.items = items.map((item) =>
        this.bomItemRepository.create({ ...item, organizationId }),
      );
    }
    return this.bomRepository.save(bom);
  }

  async removeBom(id: string, organizationId: string): Promise<void> {
    await this.findOneBom(id, organizationId);
    await this.bomRepository.delete({ id, organizationId });
  }

  // ── Work centres ─────────────────────────────────────────────────────────────

  async findAllWorkCenters(
    organizationId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<Page<WorkCenter>> {
    const paging = resolvePaging(query.page, query.pageSize);
    const [rows, total] = await this.workCenterRepository.findAndCount({
      where: { organizationId },
      order: { name: 'ASC' },
      skip: paging.skip,
      take: paging.take,
    });
    return toPage(rows, total, paging);
  }

  async findOneWorkCenter(id: string, organizationId: string): Promise<WorkCenter> {
    const workCenter = await this.workCenterRepository.findOne({
      where: { id, organizationId },
    });
    if (!workCenter) {
      throw new NotFoundError('MANUFACTURING.WORK_CENTER_NOT_FOUND', { id });
    }
    return workCenter;
  }

  createWorkCenter(dto: CreateWorkCenterDto, organizationId: string): Promise<WorkCenter> {
    const workCenter = this.workCenterRepository.create({ ...dto, organizationId });
    return this.workCenterRepository.save(workCenter);
  }

  async updateWorkCenter(
    id: string,
    dto: UpdateWorkCenterDto,
    organizationId: string,
  ): Promise<WorkCenter> {
    const workCenter = await this.findOneWorkCenter(id, organizationId);
    return this.workCenterRepository.save(
      this.workCenterRepository.merge(workCenter, dto),
    );
  }

  async removeWorkCenter(id: string, organizationId: string): Promise<void> {
    await this.findOneWorkCenter(id, organizationId);
    await this.workCenterRepository.delete({ id, organizationId });
  }
}
