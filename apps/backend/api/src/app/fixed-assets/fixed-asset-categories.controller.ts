import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { FixedAssetCategoriesService } from './fixed-asset-categories.service';
import { CreateFixedAssetCategoryDto, UpdateFixedAssetCategoryDto } from './dto/fixed-asset-category.dto';
import { FixedAssetCategoriesQueryDto } from './dto/fixed-asset.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../security/principal';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';

/**
 * The company's categories of fixed assets (audit 2026-11-07, FINB-16): what an asset of each starts
 * with, and the tax category its tax book follows. Reading them is for whoever sees the register;
 * changing them, for whoever manages it.
 */
@Controller('fixed-assets/categories')
export class FixedAssetCategoriesController {
  constructor(private readonly categories: FixedAssetCategoriesService) {}

  @Get()
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  findAll(@Query() query: FixedAssetCategoriesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.categories.findAll(user.organizationId, query.includeInactive === true);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.categories.findOne(id, user.organizationId);
  }

  @Post()
  @Idempotent()
  @HasPermission(PERMISSIONS.FIXED_ASSETS_MANAGE)
  create(@Body() dto: CreateFixedAssetCategoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.categories.create(dto, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_MANAGE)
  update(@Param('id', UuidParamPipe) id: string, @Body() dto: UpdateFixedAssetCategoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.categories.update(id, dto, user.organizationId);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_MANAGE)
  remove(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.categories.remove(id, user.organizationId);
  }
}
