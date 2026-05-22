
import { Controller, Get, Post, Body } from '@nestjs/common';
import { UnitsOfMeasureService } from './units-of-measure.service';
import { CreateUnitOfMeasureDto } from './dto/create-unit-of-measure.dto';

@Controller('units-of-measure')
export class UnitsOfMeasureController {
  constructor(private readonly uomService: UnitsOfMeasureService) {}

  @Get()
  findAll() {
    return this.uomService.findAll();
  }

  @Post()
  create(@Body() createUomDto: CreateUnitOfMeasureDto) {
    return this.uomService.create(createUomDto);
  }
}