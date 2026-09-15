import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { FixedAssetsService } from './fixed-assets.service';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { UpdateFixedAssetDto } from './dto/update-fixed-asset.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { DisposeAssetDto } from './dto/dispose-asset.dto';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AuthenticatedUser } from '../security/principal';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';

@Controller('fixed-assets')
/**
 * The fixed-asset register.
 *
 * This controller declared no permission on any route. Acquiring an asset, changing its cost or
 * useful life, and disposing of it all post to the general ledger, and every one of them was open
 * to any authenticated member of the tenant.
 */
export class FixedAssetsController {
  constructor(private readonly fixedAssetsService: FixedAssetsService) {}

  @Post()
  @HasPermission(PERMISSIONS.FIXED_ASSETS_MANAGE)
  create(@Body() createFixedAssetDto: CreateFixedAssetDto, @CurrentUser() user: AuthenticatedUser) {

    return this.fixedAssetsService.create(createFixedAssetDto, user.organizationId);
  }

  @Get()
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.fixedAssetsService.findAll(user.organizationId, query);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {

    return this.fixedAssetsService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.FIXED_ASSETS_MANAGE)
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() updateFixedAssetDto: UpdateFixedAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {

    return this.fixedAssetsService.update(id, updateFixedAssetDto, user.organizationId);
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
    @Body() disposeDto: DisposeAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fixedAssetsService.dispose(id, disposeDto, user.organizationId);
  }
}