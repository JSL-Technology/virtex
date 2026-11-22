import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Tax } from './entities/tax.entity';
import { CreateTaxDto } from './dto/create-tax.dto';
import { UpdateTaxDto } from './dto/update-tax.dto';
import { NotFoundError } from '../i18n/localized.exception';
import { translationsAfterEdit } from '../organizations/contracts/books-language.contract';

@Injectable()
export class TaxesService {
  constructor(
    @InjectRepository(Tax)
    private readonly taxRepository: Repository<Tax>,
  ) {}

  /** The manager provisioning queries the statutory table with when it runs outside a transaction. */
  get manager(): EntityManager {
    return this.taxRepository.manager;
  }

  async create(createTaxDto: CreateTaxDto, organizationId: string, manager?: EntityManager): Promise<Tax> {
    const writer = manager ?? this.taxRepository.manager;
    const nameTranslations = await translationsAfterEdit(writer, organizationId, {}, createTaxDto.nameTranslations);
    return writer.save(writer.create(Tax, { ...createTaxDto, nameTranslations, organizationId }));
  }

  findAll(organizationId: string): Promise<Tax[]> {
    return this.taxRepository.find({ where: { organizationId }, order: { name: 'ASC' } });
  }

  async findOne(id: string, organizationId: string): Promise<Tax> {
    const tax = await this.taxRepository.findOne({ where: { id, organizationId } });
    if (!tax) {
      throw new NotFoundError('taxes.tax_id_not_found', { id });
    }
    return tax;
  }

  async update(id: string, updateTaxDto: UpdateTaxDto, organizationId: string): Promise<Tax> {
    const tax = await this.findOne(id, organizationId);
    const { nameTranslations, ...changes } = updateTaxDto;
    const translations = await translationsAfterEdit(this.taxRepository.manager, organizationId, tax.nameTranslations, nameTranslations);
    // Assigned after the merge: `merge` deep-merges an object column, so a language sent empty to
    // remove it would survive inside it.
    const updatedTax = this.taxRepository.merge(tax, changes);
    updatedTax.nameTranslations = translations;
    return this.taxRepository.save(updatedTax);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    await this.findOne(id, organizationId);
    await this.taxRepository.delete(id);
  }
}