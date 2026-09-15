import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { SupplyChainService } from './supply-chain.service';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { CreateBinLocationDto } from './dto/create-bin-location.dto';
import { UpdateBinLocationDto } from './dto/update-bin-location.dto';
import { CreateLandedCostDto } from './dto/create-landed-cost.dto';
import { UpdateLandedCostDto } from './dto/update-landed-cost.dto';

@Controller('wms')
export class SupplyChainController {
  constructor(private readonly supplyChainService: SupplyChainService) {}

  // ── Warehouses ───────────────────────────────────────────────────────────────

  @Get('warehouses')
  @HasPermission(PERMISSIONS.WMS_VIEW)
  findAllWarehouses(@CurrentUser() user: AuthenticatedUser) {
    return this.supplyChainService.findAllWarehouses(user.organizationId);
  }

  @Get('warehouses/:id')
  @HasPermission(PERMISSIONS.WMS_VIEW)
  findOneWarehouse(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplyChainService.findOneWarehouse(id, user.organizationId);
  }

  @Post('warehouses')
  @HasPermission(PERMISSIONS.WMS_MANAGE)
  createWarehouse(@Body() dto: CreateWarehouseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.supplyChainService.createWarehouse(dto, user.organizationId);
  }

  @Patch('warehouses/:id')
  @HasPermission(PERMISSIONS.WMS_MANAGE)
  updateWarehouse(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplyChainService.updateWarehouse(id, dto, user.organizationId);
  }

  @Delete('warehouses/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.WMS_MANAGE)
  removeWarehouse(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplyChainService.removeWarehouse(id, user.organizationId);
  }

  // ── Bin locations ────────────────────────────────────────────────────────────

  @Get('bin-locations')
  @HasPermission(PERMISSIONS.WMS_VIEW)
  findBinLocations(
    @CurrentUser() user: AuthenticatedUser,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.supplyChainService.findBinLocations(user.organizationId, warehouseId);
  }

  @Post('bin-locations')
  @HasPermission(PERMISSIONS.WMS_MANAGE)
  createBinLocation(@Body() dto: CreateBinLocationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.supplyChainService.createBinLocation(dto, user.organizationId);
  }

  @Patch('bin-locations/:id')
  @HasPermission(PERMISSIONS.WMS_MANAGE)
  updateBinLocation(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdateBinLocationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplyChainService.updateBinLocation(id, dto, user.organizationId);
  }

  @Delete('bin-locations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.WMS_MANAGE)
  removeBinLocation(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplyChainService.removeBinLocation(id, user.organizationId);
  }

  // ── Landed-cost schemes ──────────────────────────────────────────────────────

  @Get('landed-costs')
  @HasPermission(PERMISSIONS.WMS_VIEW)
  findLandedCosts(@CurrentUser() user: AuthenticatedUser) {
    return this.supplyChainService.findLandedCosts(user.organizationId);
  }

  @Post('landed-costs')
  @HasPermission(PERMISSIONS.WMS_MANAGE)
  createLandedCost(@Body() dto: CreateLandedCostDto, @CurrentUser() user: AuthenticatedUser) {
    return this.supplyChainService.createLandedCost(dto, user.organizationId);
  }

  @Patch('landed-costs/:id')
  @HasPermission(PERMISSIONS.WMS_MANAGE)
  updateLandedCost(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdateLandedCostDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplyChainService.updateLandedCost(id, dto, user.organizationId);
  }

  @Delete('landed-costs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.WMS_MANAGE)
  removeLandedCost(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplyChainService.removeLandedCost(id, user.organizationId);
  }
}
