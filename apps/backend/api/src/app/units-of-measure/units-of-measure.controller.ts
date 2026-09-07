
import { Controller, Get, Post, Body } from '@nestjs/common';
import { UnitsOfMeasureService } from './units-of-measure.service';
import { CreateUnitOfMeasureDto } from './dto/create-unit-of-measure.dto';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('units-of-measure')
export class UnitsOfMeasureController {
  constructor(private readonly uomService: UnitsOfMeasureService) {}

  @Get()
  @HasPermission(PERMISSIONS.UNITS_OF_MEASURE_VIEW)
  findAll() {
    return this.uomService.findAll();
  }

  @Post()
  @HasPermission(PERMISSIONS.UNITS_OF_MEASURE_MANAGE)
  create(@Body() createUomDto: CreateUnitOfMeasureDto) {
    return this.uomService.create(createUomDto);
  }
}