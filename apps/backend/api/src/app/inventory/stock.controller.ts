import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { StockQueriesService } from './stock-queries.service';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import { StockTransfersService } from './stock-transfers.service';
import { StockMovementsQueryDto, StockOnHandQueryDto } from './dto/stock-query.dto';
import { InventoryAdjustmentQueryDto, SaveInventoryAdjustmentDto } from './dto/inventory-adjustment.dto';
import { SaveStockTransferDto, StockTransferQueryDto } from './dto/stock-transfer.dto';

/**
 * Stock: what is held where, how it got there, and the documents that move it by hand.
 *
 * Registered before the catalogue controller, whose `GET inventory/:id` would otherwise claim
 * `inventory/stock` as a product id.
 */
@ApiTags('Inventory')
@Controller('inventory')
export class StockController {
  constructor(
    private readonly queries: StockQueriesService,
    private readonly adjustments: InventoryAdjustmentsService,
    private readonly transfers: StockTransfersService,
  ) {}

  @Get('stock')
  @HasPermission(PERMISSIONS.INVENTORY_VIEW_STOCK)
  @ApiOperation({ summary: 'Existencias por artículo y almacén, valoradas.' })
  onHand(@Query() query: StockOnHandQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.queries.onHand(user.organizationId, query);
  }

  @Get('movements')
  @HasPermission(PERMISSIONS.INVENTORY_VIEW_STOCK)
  @ApiOperation({ summary: 'Kardex: movimientos con saldo corrido.' })
  movements(@Query() query: StockMovementsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.queries.movements(user.organizationId, query);
  }

  // ── Adjustments ───────────────────────────────────────────────────────────

  @Get('adjustments')
  @HasPermission(PERMISSIONS.INVENTORY_VIEW_STOCK)
  listAdjustments(@Query() query: InventoryAdjustmentQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.adjustments.findAll(user.organizationId, query);
  }

  @Get('adjustments/:id')
  @HasPermission(PERMISSIONS.INVENTORY_VIEW_STOCK)
  getAdjustment(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.adjustments.findOne(id, user.organizationId);
  }

  @Post('adjustments')
  @HasPermission(PERMISSIONS.INVENTORY_ADJUST)
  createAdjustment(@Body() dto: SaveInventoryAdjustmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.adjustments.create(dto, user.organizationId, user.id);
  }

  @Patch('adjustments/:id')
  @HasPermission(PERMISSIONS.INVENTORY_ADJUST)
  updateAdjustment(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: SaveInventoryAdjustmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adjustments.update(id, dto, user.organizationId);
  }

  @Post('adjustments/:id/post')
  @HasPermission(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({ summary: 'Contabiliza el ajuste: mueve existencias y registra el asiento.' })
  postAdjustment(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.adjustments.post(id, user.organizationId, user.id);
  }

  @Post('adjustments/:id/cancel')
  @HasPermission(PERMISSIONS.INVENTORY_ADJUST)
  cancelAdjustment(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.adjustments.cancel(id, user.organizationId);
  }

  // ── Transfers ─────────────────────────────────────────────────────────────

  @Get('transfers')
  @HasPermission(PERMISSIONS.INVENTORY_VIEW_STOCK)
  listTransfers(@Query() query: StockTransferQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transfers.findAll(user.organizationId, query);
  }

  @Get('transfers/:id')
  @HasPermission(PERMISSIONS.INVENTORY_VIEW_STOCK)
  getTransfer(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transfers.findOne(id, user.organizationId);
  }

  @Post('transfers')
  @HasPermission(PERMISSIONS.INVENTORY_TRANSFER)
  createTransfer(@Body() dto: SaveStockTransferDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transfers.create(dto, user.organizationId, user.id);
  }

  @Patch('transfers/:id')
  @HasPermission(PERMISSIONS.INVENTORY_TRANSFER)
  updateTransfer(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: SaveStockTransferDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.transfers.update(id, dto, user.organizationId);
  }

  @Post('transfers/:id/post')
  @HasPermission(PERMISSIONS.INVENTORY_TRANSFER)
  postTransfer(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transfers.post(id, user.organizationId, user.id);
  }

  @Post('transfers/:id/cancel')
  @HasPermission(PERMISSIONS.INVENTORY_TRANSFER)
  cancelTransfer(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transfers.cancel(id, user.organizationId);
  }
}
