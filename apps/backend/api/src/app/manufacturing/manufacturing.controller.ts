import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ManufacturingService } from './manufacturing.service';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { CreateProductionOrderDto } from './dto/create-production-order.dto';
import { UpdateProductionOrderDto } from './dto/update-production-order.dto';
import { CreateWorkCenterDto } from './dto/create-work-center.dto';
import { UpdateWorkCenterDto } from './dto/update-work-center.dto';
import { CreateBillOfMaterialDto } from './dto/create-bill-of-material.dto';
import { UpdateBillOfMaterialDto } from './dto/update-bill-of-material.dto';

/**
 * Every handler resolves the tenant from the authenticated principal (`user.organizationId`) and
 * passes it to the service. Nothing here reads an organization id from the body or the query — the
 * previous controller took `@Body() : any` and let the caller decide.
 */
@Controller('manufacturing')
@UseGuards(JwtAuthGuard)
export class ManufacturingController {
  constructor(private readonly manufacturingService: ManufacturingService) {}

  // ── Production orders ────────────────────────────────────────────────────────

  @Get('orders')
  @HasPermission(PERMISSIONS.MANUFACTURING_VIEW)
  findAllOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.manufacturingService.findAllOrders(user.organizationId, { page, pageSize });
  }

  @Get('orders/:id')
  @HasPermission(PERMISSIONS.MANUFACTURING_VIEW)
  findOneOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manufacturingService.findOneOrder(id, user.organizationId);
  }

  @Post('orders')
  @HasPermission(PERMISSIONS.MANUFACTURING_MANAGE)
  createOrder(
    @Body() dto: CreateProductionOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manufacturingService.createOrder(dto, user.organizationId);
  }

  @Patch('orders/:id')
  @HasPermission(PERMISSIONS.MANUFACTURING_MANAGE)
  updateOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductionOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manufacturingService.updateOrder(id, dto, user.organizationId);
  }

  @Delete('orders/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.MANUFACTURING_MANAGE)
  removeOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manufacturingService.removeOrder(id, user.organizationId);
  }

  // ── Bills of materials ───────────────────────────────────────────────────────

  @Get('bills-of-materials')
  @HasPermission(PERMISSIONS.MANUFACTURING_VIEW)
  findAllBoms(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.manufacturingService.findAllBoms(user.organizationId, { page, pageSize });
  }

  @Get('bills-of-materials/:id')
  @HasPermission(PERMISSIONS.MANUFACTURING_VIEW)
  findOneBom(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manufacturingService.findOneBom(id, user.organizationId);
  }

  @Post('bills-of-materials')
  @HasPermission(PERMISSIONS.MANUFACTURING_MANAGE)
  createBom(
    @Body() dto: CreateBillOfMaterialDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manufacturingService.createBom(dto, user.organizationId);
  }

  @Patch('bills-of-materials/:id')
  @HasPermission(PERMISSIONS.MANUFACTURING_MANAGE)
  updateBom(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBillOfMaterialDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manufacturingService.updateBom(id, dto, user.organizationId);
  }

  @Delete('bills-of-materials/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.MANUFACTURING_MANAGE)
  removeBom(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manufacturingService.removeBom(id, user.organizationId);
  }

  // ── Work centres ─────────────────────────────────────────────────────────────

  @Get('work-centers')
  @HasPermission(PERMISSIONS.MANUFACTURING_VIEW)
  findAllWorkCenters(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.manufacturingService.findAllWorkCenters(user.organizationId, { page, pageSize });
  }

  @Get('work-centers/:id')
  @HasPermission(PERMISSIONS.MANUFACTURING_VIEW)
  findOneWorkCenter(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manufacturingService.findOneWorkCenter(id, user.organizationId);
  }

  @Post('work-centers')
  @HasPermission(PERMISSIONS.MANUFACTURING_MANAGE)
  createWorkCenter(
    @Body() dto: CreateWorkCenterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manufacturingService.createWorkCenter(dto, user.organizationId);
  }

  @Patch('work-centers/:id')
  @HasPermission(PERMISSIONS.MANUFACTURING_MANAGE)
  updateWorkCenter(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkCenterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manufacturingService.updateWorkCenter(id, dto, user.organizationId);
  }

  @Delete('work-centers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.MANUFACTURING_MANAGE)
  removeWorkCenter(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manufacturingService.removeWorkCenter(id, user.organizationId);
  }
}
