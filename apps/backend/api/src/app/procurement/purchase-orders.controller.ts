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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';
import { PurchaseOrdersService } from './purchase-orders.service';
import {
  CreatePurchaseOrderDto,
  PurchaseOrderQueryDto,
  ReceivePurchaseOrderDto,
  RejectDto,
  UpdatePurchaseOrderDto,
} from './dto/purchase-order.dto';

/**
 * Purchase orders.
 *
 * There was no controller and no table: the purchasing screen listed four orders invented in the
 * browser. See {@link PurchaseOrdersService} for why none of these routes posts to the ledger.
 *
 * Approval is its own permission. Raising an order and authorising the spend are the two halves of
 * the control, and a role that can do both is not a control.
 */
@ApiTags('Procurement')
@ApiBearerAuth()
@Controller('procurement/orders')
@UseGuards(JwtAuthGuard)
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}

  @Get()
  @HasPermission(PERMISSIONS.PROCUREMENT_VIEW)
  @ApiOperation({ summary: 'Lista las órdenes de compra del inquilino.' })
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: PurchaseOrderQueryDto) {
    return this.orders.findAll(user.organizationId, query);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.PROCUREMENT_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.findOne(id, user.organizationId);
  }

  @Post()
  @Idempotent()
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  @ApiOperation({ summary: 'Crea una orden de compra en borrador.' })
  create(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.create(dto, user.organizationId, user.id);
  }

  @Post('from-requisition/:requisitionId')
  @Idempotent()
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  @ApiOperation({ summary: 'Convierte una requisición aprobada en una orden a un proveedor.' })
  fromRequisition(
    @Param('requisitionId', UuidParamPipe) requisitionId: string,
    @Body() body: { supplierId: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.createFromRequisition(
      requisitionId,
      body.supplierId,
      user.organizationId,
      user.id,
    );
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdatePurchaseOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.update(id, dto, user.organizationId);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  submit(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.submit(id, user.organizationId);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.PROCUREMENT_APPROVE)
  approve(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.approve(id, user.organizationId, user.id);
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.PROCUREMENT_APPROVE)
  reopen(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.reopen(id, user.organizationId);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  @ApiOperation({ summary: 'Marca la orden como enviada al proveedor.' })
  send(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.send(id, user.organizationId);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  @ApiOperation({ summary: 'Registra lo recibido contra la orden, línea por línea.' })
  receive(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: ReceivePurchaseOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.receive(id, dto, user.organizationId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.PROCUREMENT_APPROVE)
  cancel(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: RejectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.cancel(id, user.organizationId, dto.reason);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.PROCUREMENT_MANAGE)
  remove(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.remove(id, user.organizationId);
  }
}
