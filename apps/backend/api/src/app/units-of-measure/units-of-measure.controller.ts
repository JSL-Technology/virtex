
import { Controller, Get, Post, Body, Delete, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { UnitsOfMeasureService } from './units-of-measure.service';
import { CreateUnitOfMeasureDto } from './dto/create-unit-of-measure.dto';
import { CreateTenantUnitOfMeasureDto } from './dto/create-tenant-unit-of-measure.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { RequiresPlatformPermission } from '../security/decorators/platform-permission.decorator';
import { PLATFORM_PERMISSIONS } from '../security/platform-permissions';
import { PERMISSIONS } from '../shared/permissions';

@Controller('units-of-measure')
export class UnitsOfMeasureController {
  constructor(private readonly uomService: UnitsOfMeasureService) {}

  @Get()
  @HasPermission(PERMISSIONS.UNITS_OF_MEASURE_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.uomService.findAll(user.organizationId);
  }

  /** A unit of the company's own — what the screen's «Nueva unidad» creates (QA M-18). */
  @Post('company')
  @HasPermission(PERMISSIONS.UNITS_OF_MEASURE_MANAGE)
  createForCompany(@Body() dto: CreateTenantUnitOfMeasureDto, @CurrentUser() user: AuthenticatedUser) {
    return this.uomService.createForTenant(user.organizationId, dto);
  }

  @Delete('company/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.UNITS_OF_MEASURE_MANAGE)
  removeForCompany(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.uomService.removeForTenant(user.organizationId, id);
  }

  @Post()
  @HasPermission(PERMISSIONS.UNITS_OF_MEASURE_MANAGE)
  // Units of measure are shared by every tenant.
  @RequiresPlatformPermission(PLATFORM_PERMISSIONS.REFERENCE_DATA_MANAGE)
  create(@Body() createUomDto: CreateUnitOfMeasureDto) {
    return this.uomService.create(createUomDto);
  }
}