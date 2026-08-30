import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from './entities/supplier.entity';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { DataSource } from 'typeorm';
import { SaasService } from '../saas/saas.service';
import { SaasResource } from '../saas/enums/saas-resource.enum';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly supplierRepository: Repository<Supplier>,
    private readonly dataSource: DataSource,
    private readonly saasService: SaasService,
  ) {}

  /** Create a supplier, metered in the same transaction as the insert. */
  async create(
    createSupplierDto: CreateSupplierDto,
    organizationId: string,
  ): Promise<Supplier> {
    return this.dataSource.transaction(async (manager) => {
      await this.saasService.enforceLimit(manager, organizationId, SaasResource.SUPPLIERS);

      const supplier = manager.create(Supplier, {
        ...createSupplierDto,
        organizationId,
      });
      return manager.save(supplier);
    });
  }

  findAll(organizationId: string): Promise<Supplier[]> {
    return this.supplierRepository.find({
      where: { organizationId },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string, organizationId: string): Promise<Supplier> {
    const supplier = await this.supplierRepository.findOne({
      where: { id, organizationId },
    });
    if (!supplier) {
      throw new NotFoundException(`Proveedor con ID "${id}" no encontrado.`);
    }
    return supplier;
  }

  async update(
    id: string,
    updateSupplierDto: UpdateSupplierDto,
    organizationId: string,
  ): Promise<Supplier> {
    const supplier = await this.findOne(id, organizationId);
    const updatedSupplier = this.supplierRepository.merge(
      supplier,
      updateSupplierDto,
    );
    return this.supplierRepository.save(updatedSupplier);
  }

  /**
   * Delete a supplier, and give the seat of quota back.
   *
   * `SUPPLIERS` is a LIFETIME quota, so without the release it counted "suppliers ever created"
   * rather than "suppliers that exist" — a tenant at its limit could delete every record it had
   * and still be unable to create one. Both happen in the same transaction, so a failed delete
   * cannot hand out free quota.
   */
  async remove(id: string, organizationId: string): Promise<void> {
    const supplier = await this.findOne(id, organizationId);
    await this.dataSource.transaction(async (manager) => {
      await manager.remove(Supplier, supplier);
      await this.saasService.releaseUsage(manager, organizationId, SaasResource.SUPPLIERS);
    });
  }
}