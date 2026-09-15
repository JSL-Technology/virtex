
import { Controller, Get, Post, Body, Patch, Param, Delete, HttpCode, HttpStatus } from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { DimensionsService } from './dimensions.service';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { CreateDimensionDto, UpdateDimensionDto } from './dto/dimension.dto';
import { CreateDimensionRuleDto } from './dto/dimension-rule.dto';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('dimensions')
export class DimensionsController {
  constructor(private readonly dimensionsService: DimensionsService) {}

  @Post()
  @HasPermission(PERMISSIONS.DIMENSIONS_MANAGE)
  create(@Body() createDto: CreateDimensionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.dimensionsService.create(createDto, user.organizationId);
  }

  @Get()
  @HasPermission(PERMISSIONS.DIMENSIONS_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.dimensionsService.findAll(user.organizationId);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.DIMENSIONS_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dimensionsService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.DIMENSIONS_MANAGE)
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() updateDto: UpdateDimensionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.dimensionsService.update(id, updateDto, user.organizationId);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.DIMENSIONS_MANAGE)
  remove(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dimensionsService.remove(id, user.organizationId);
  }

  @Get('rules/:accountId')
  @HasPermission(PERMISSIONS.DIMENSIONS_VIEW)
  getRulesForAccount(@Param('accountId', UuidParamPipe) accountId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dimensionsService.getRulesForAccount(accountId, user.organizationId);
  }
  
  @Post('rules')
  @HasPermission(PERMISSIONS.DIMENSIONS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  createRule(@Body() createRuleDto: CreateDimensionRuleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.dimensionsService.createRule(createRuleDto, user.organizationId);
  }

  @Delete('rules/:accountId/:dimensionId')
  @HasPermission(PERMISSIONS.DIMENSIONS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteRule(
    @Param('accountId', UuidParamPipe) accountId: string,
    @Param('dimensionId', UuidParamPipe) dimensionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dimensionsService.deleteRule(accountId, dimensionId, user.organizationId);
  }

}