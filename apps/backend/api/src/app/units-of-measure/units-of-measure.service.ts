
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UnitOfMeasure } from './entities/unit-of-measure.entity';
import { CreateUnitOfMeasureDto } from './dto/create-unit-of-measure.dto';

/**
 * Units of measure are a **global** catalogue, on purpose.
 *
 * The entity carries no `organization_id`: a kilogram is a kilogram in every tenant, and products,
 * invoice lines and stock movements across the product all reference the same set. That is why the
 * read is unscoped and why writing one is gated behind `UNITS_OF_MEASURE_MANAGE` rather than being
 * open — it changes shared reference data. If units ever need to be tenant-specific, the entity
 * needs an `organization_id` column and a migration first; until then, global is the intended and
 * documented behaviour, not a missing `where`.
 */
@Injectable()
export class UnitsOfMeasureService {
  constructor(
    @InjectRepository(UnitOfMeasure)
    private readonly uomRepository: Repository<UnitOfMeasure>,
  ) {}

  findAll(): Promise<UnitOfMeasure[]> {
    // tenant-scope-guard-allow: units of measure are a global reference catalogue (see class doc).
    return this.uomRepository.find();
  }

  async create(createUomDto: CreateUnitOfMeasureDto): Promise<UnitOfMeasure> {
    const uom = this.uomRepository.create(createUomDto);
    return this.uomRepository.save(uom);
  }
}