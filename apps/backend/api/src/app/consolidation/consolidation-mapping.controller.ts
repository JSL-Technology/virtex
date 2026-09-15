
import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ConsolidationMappingService } from './consolidation-mapping.service';
import { CreateConsolidationMapDto } from './dto/create-consolidation-map.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('consolidation/mapping')
export class ConsolidationMappingController {
  constructor(private readonly mappingService: ConsolidationMappingService) {}

  @HasPermission(PERMISSIONS.FINANCIALS_CONSOLIDATE)
  @Get(':subsidiaryId')
  getMap(
      @Param('subsidiaryId', UuidParamPipe) subsidiaryId: string,
      @CurrentUser() user: AuthenticatedUser
  ) {
    return this.mappingService.getMapForSubsidiary(user.organizationId, subsidiaryId);
  }

  @HasPermission(PERMISSIONS.FINANCIALS_CONSOLIDATE)
  @Post()
  createOrUpdateMap(
    @Body() dto: CreateConsolidationMapDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.mappingService.createOrUpdateMap(user.organizationId, dto);
  }
}