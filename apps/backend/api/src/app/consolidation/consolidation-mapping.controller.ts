
import { Controller, Post, Body, UseGuards, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { ConsolidationMappingService } from './consolidation-mapping.service';
import { CreateConsolidationMapDto } from './dto/create-consolidation-map.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('consolidation/mapping')
@UseGuards(JwtAuthGuard)
export class ConsolidationMappingController {
  constructor(private readonly mappingService: ConsolidationMappingService) {}

  @HasPermission(PERMISSIONS.FINANCIALS_CONSOLIDATE)
  @Get(':subsidiaryId')
  getMap(
      @Param('subsidiaryId', ParseUUIDPipe) subsidiaryId: string,
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