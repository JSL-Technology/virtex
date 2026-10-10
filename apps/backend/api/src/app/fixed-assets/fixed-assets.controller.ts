import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { FixedAssetsService } from './fixed-assets.service';
import { DepreciationService } from './depreciation.service';
import {
  CreateFixedAssetDto,
  DepreciationRunDto,
  DisposeAssetDto,
  FixedAssetsQueryDto,
  UpdateFixedAssetDto,
} from './dto/fixed-asset.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../security/principal';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';

/**
 * The fixed-asset register and its depreciation.
 *
 * Every route declares its permission: acquiring, editing and disposing of an asset, and running
 * depreciation, all reach the general ledger. They were once open to any member of the tenant.
 */
@Controller('fixed-assets')
export class FixedAssetsController {
  constructor(
    private readonly fixedAssetsService: FixedAssetsService,
    private readonly depreciation: DepreciationService,
  ) {}

  // Declared before `:id`, so `depreciation-runs` is never read as an asset id.

  /** What a run for the month would charge, asset by asset, without posting. */
  @Get('depreciation-runs/preview')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  previewDepreciation(@Query() query: DepreciationRunDto, @CurrentUser() user: AuthenticatedUser) {
    return this.depreciation.preview(user.organizationId, `${query.period}-01`);
  }

  /**
   * Charge every asset everything it is due through the month. Idempotent by construction: a month
   * already charged is not charged again, whoever ran it.
   */
  @Post('depreciation-runs')
  @Idempotent()
  @HasPermission(PERMISSIONS.FIXED_ASSETS_MANAGE)
  runDepreciation(@Body() dto: DepreciationRunDto, @CurrentUser() user: AuthenticatedUser) {
    return this.depreciation.runMonthlyDepreciation(user.organizationId, `${dto.period}-01`);
  }

  @Post()
  @Idempotent()
  @HasPermission(PERMISSIONS.FIXED_ASSETS_MANAGE)
  create(@Body() dto: CreateFixedAssetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.fixedAssetsService.create(dto, user.organizationId, user.id);
  }

  @Get()
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: FixedAssetsQueryDto) {
    return this.fixedAssetsService.findAll(user.organizationId, query);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.fixedAssetsService.findOne(id, user.organizationId);
  }

  /** The depreciation board: months charged, and the projection of the rest. */
  @Get(':id/schedule')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  schedule(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.fixedAssetsService.schedule(id, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_MANAGE)
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdateFixedAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fixedAssetsService.update(id, dto, user.organizationId);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_MANAGE)
  remove(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.fixedAssetsService.remove(id, user.organizationId);
  }

  @Post(':id/dispose')
  @Idempotent()
  @HasPermission(PERMISSIONS.FIXED_ASSETS_DISPOSE)
  dispose(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: DisposeAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fixedAssetsService.dispose(id, dto, user.organizationId, user.id);
  }
}
