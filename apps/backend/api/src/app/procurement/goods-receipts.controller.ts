import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';
import { PeriodLockGuard } from '../accounting/guards/period-lock.guard';
import { BranchScoped } from '../organizations/contracts/branch-scope.interceptor';
import { PurchaseOrderReceipt } from './entities/purchase-order-receipt.entity';
import { GoodsReceiptsService } from './goods-receipts.service';
import { CreateGoodsReceiptDto, GoodsReceiptQueryDto, VoidGoodsReceiptDto } from './dto/goods-receipt.dto';

/** Goods received against purchase orders, as documents: list, record, open, void. */
@ApiTags('Procurement')
@ApiBearerAuth()
@Controller('procurement/receipts')
// Every `:id` here is one of these documents: acting on it needs access to its branch.
@BranchScoped(PurchaseOrderReceipt)
export class GoodsReceiptsController {
  constructor(private readonly receipts: GoodsReceiptsService) {}

  @Get()
  @HasPermission(PERMISSIONS.PROCUREMENT_VIEW)
  @ApiOperation({ summary: 'Lista las recepciones de mercancía.' })
  findAll(@Query() query: GoodsReceiptQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.receipts.findAll(user.organizationId, query, user.id);
  }

  @Post()
  @Idempotent()
  @UseGuards(PeriodLockGuard)
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  @ApiOperation({ summary: 'Registra una recepción contra una orden de compra: existencias y asiento.' })
  create(@Body() dto: CreateGoodsReceiptDto, @CurrentUser() user: AuthenticatedUser) {
    return this.receipts.create(dto, user.organizationId, user.id);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.PROCUREMENT_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.receipts.findOne(id, user.organizationId, user.id);
  }

  @Post(':id/void')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  @ApiOperation({ summary: 'Anula una recepción no facturada: devuelve las existencias y revierte el asiento.' })
  voidReceipt(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: VoidGoodsReceiptDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.receipts.voidReceipt(id, dto, user.organizationId, user.id);
  }
}
