
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UnitOfMeasure } from './entities/unit-of-measure.entity';
import { CreateUnitOfMeasureDto } from './dto/create-unit-of-measure.dto';

@Injectable()
export class UnitsOfMeasureService {
  constructor(
    @InjectRepository(UnitOfMeasure)
    private readonly uomRepository: Repository<UnitOfMeasure>,
  ) {}

  findAll(): Promise<UnitOfMeasure[]> {
    return this.uomRepository.find();
  }

  async create(createUomDto: CreateUnitOfMeasureDto): Promise<UnitOfMeasure> {
    const uom = this.uomRepository.create(createUomDto);
    return this.uomRepository.save(uom);
  }
}