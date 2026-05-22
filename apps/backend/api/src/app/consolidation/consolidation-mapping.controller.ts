
import { Controller, Post, Body, UseGuards, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { ConsolidationMappingService } from './consolidation-mapping.service';
import { CreateConsolidationMapDto } from './dto/create-consolidation-map.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';

@Controller('consolidation/mapping')
@UseGuards(JwtAuthGuard)
export class ConsolidationMappingController {
  constructor(private readonly mappingService: ConsolidationMappingService) {}

  @Get(':subsidiaryId')
  getMap(
      @Param('subsidiaryId', ParseUUIDPipe) subsidiaryId: string,
      @CurrentUser() user: User
  ) {
    return this.mappingService.getMapForSubsidiary(user.organizationId, subsidiaryId);
  }

  @Post()
  createOrUpdateMap(
    @Body() dto: CreateConsolidationMapDto,
    @CurrentUser() user: User,
  ) {
    return this.mappingService.createOrUpdateMap(user.organizationId, dto);
  }
}