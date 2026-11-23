import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';
import { LandedCostsService } from './landed-costs.service';
import { ApplyLandedCostDto, VoidLandedCostDto } from './dto/landed-cost-allocation.dto';

/** Landed costs applied to received goods (audit 2026-11-07, CMP-21). */
@ApiTags('Procurement')
@ApiBearerAuth()
@Controller('procurement/landed-costs')
export class LandedCostsController {
  constructor(private readonly landedCosts: LandedCostsService) {}

  @Get()
  @HasPermission(PERMISSIONS.PROCUREMENT_VIEW)
  @ApiOperation({ summary: 'Lista los costos de importación aplicados.' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.landedCosts.list(user.organizationId);
  }

  @Post()
  @Idempotent()
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  @ApiOperation({ summary: 'Prorratea un costo de importación sobre recepciones y revaloriza el inventario.' })
  apply(@Body() dto: ApplyLandedCostDto, @CurrentUser() user: AuthenticatedUser) {
    return this.landedCosts.apply(dto, user.organizationId, user.id);
  }

  @Post(':id/void')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  @ApiOperation({ summary: 'Anula un costo de importación aplicado.' })
  void(@Param('id', UuidParamPipe) id: string, @Body() dto: VoidLandedCostDto, @CurrentUser() user: AuthenticatedUser) {
    return this.landedCosts.void(id, dto.reason, user.organizationId, user.id);
  }
}
