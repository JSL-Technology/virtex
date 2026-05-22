import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from './entities/supplier.entity';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly supplierRepository: Repository<Supplier>,
  ) {}

  create(
    createSupplierDto: CreateSupplierDto,
    organizationId: string,
  ): Promise<Supplier> {
    const supplier = this.supplierRepository.create({
      ...createSupplierDto,
      organizationId,
    });
    return this.supplierRepository.save(supplier);
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

  async remove(id: string, organizationId: string): Promise<void> {
    const supplier = await this.findOne(id, organizationId);
    await this.supplierRepository.remove(supplier);
  }
}