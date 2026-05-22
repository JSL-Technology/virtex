import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Tax } from './entities/tax.entity';
import { CreateTaxDto } from './dto/create-tax.dto';
import { UpdateTaxDto } from './dto/update-tax.dto';

@Injectable()
export class TaxesService {
  constructor(
    @InjectRepository(Tax)
    private readonly taxRepository: Repository<Tax>,
  ) {}

  create(createTaxDto: CreateTaxDto, organizationId: string, manager?: EntityManager): Promise<Tax> {
    if (manager) {
        const tax = manager.create(Tax, { ...createTaxDto, organizationId });
        return manager.save(tax);
    }
    const tax = this.taxRepository.create({ ...createTaxDto, organizationId });
    return this.taxRepository.save(tax);
  }

  findAll(organizationId: string): Promise<Tax[]> {
    return this.taxRepository.find({ where: { organizationId }, order: { name: 'ASC' } });
  }

  async findOne(id: string, organizationId: string): Promise<Tax> {
    const tax = await this.taxRepository.findOne({ where: { id, organizationId } });
    if (!tax) {
      throw new NotFoundException(`Impuesto con ID "${id}" no encontrado.`);
    }
    return tax;
  }

  async update(id: string, updateTaxDto: UpdateTaxDto, organizationId: string): Promise<Tax> {
    const tax = await this.findOne(id, organizationId);
    const updatedTax = this.taxRepository.merge(tax, updateTaxDto);
    return this.taxRepository.save(updatedTax);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    await this.findOne(id, organizationId);
    await this.taxRepository.delete(id);
  }
}