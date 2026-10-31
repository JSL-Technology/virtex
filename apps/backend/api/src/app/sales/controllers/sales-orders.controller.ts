import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { HasPermission } from '../../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../../shared/permissions';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../security/principal';
import type { HttpResponse as Response } from '../../common/http/http.types';
import { BadRequestError } from '../../i18n/localized.exception';
import { SalesOrdersService } from '../services/sales-orders.service';
import { SalesOrderStatus } from '../entities/sales-order.entity';
import { DeliveryNoteStatus } from '../entities/delivery-note.entity';
import { CreateSalesOrderDto, DeliverDto, InvoiceOrderDto, ReasonDto } from '../dto/sales-order.dto';
import { deliveryNoteHtml } from '../services/delivery-note.document';
import { organizationFiscalIdentity } from '../../organizations/contracts/fiscal-identity.contract';
import { DataSource } from 'typeorm';

/**
 * Sales orders and their conduces. Reading takes `invoices:view`; creating, delivering and
 * invoicing take `invoices:create` — they commit stock and fiscal documents; cancelling an order
 * or voiding a conduce takes `invoices:void`.
 */
@Controller('sales')
export class SalesOrdersController {
  constructor(
    private readonly orders: SalesOrdersService,
    private readonly dataSource: DataSource,
  ) {}

  @Get('orders')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  list(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string, @Query('customerId') customerId?: string) {
    if (status && !(Object.values(SalesOrderStatus) as string[]).includes(status)) {
      throw new BadRequestError('sales.orders.status_unknown', { status });
    }
    return this.orders.list(user.organizationId, {
      status: status as SalesOrderStatus | undefined,
      customerId: customerId && /^[0-9a-f-]{36}$/i.test(customerId) ? customerId : undefined,
    });
  }

  @Post('orders')
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  create(@Body() dto: CreateSalesOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.create(dto, user.organizationId, user.id);
  }

  /** An accepted quote becomes an order. */
  @Post('quotes/:quoteId/order')
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  fromQuote(@Param('quoteId', UuidParamPipe) quoteId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.fromQuote(quoteId, user.organizationId, user.id);
  }

  @Get('orders/:id')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  get(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.get(user.organizationId, id);
  }

  @Post('orders/:id/cancel')
  @HasPermission(PERMISSIONS.INVOICES_VOID)
  cancel(@Param('id', UuidParamPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.cancel(user.organizationId, id, dto.reason);
  }

  @Post('orders/:id/close')
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  close(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.close(user.organizationId, id);
  }

  /** A conduce: the goods leave and the stock moves. */
  @Post('orders/:id/deliveries')
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  deliver(@Param('id', UuidParamPipe) id: string, @Body() dto: DeliverDto, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.deliver(user.organizationId, id, dto, user.id);
  }

  /** Invoice the delivered goods (all posted conduces, or those named) and the ordered services. */
  @Post('orders/:id/invoice')
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  invoice(@Param('id', UuidParamPipe) id: string, @Body() dto: InvoiceOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.invoice(user.organizationId, id, user.id, dto.deliveryNoteIds);
  }

  @Get('deliveries')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  deliveries(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    if (status && !(Object.values(DeliveryNoteStatus) as string[]).includes(status)) {
      throw new BadRequestError('sales.orders.status_unknown', { status });
    }
    return this.orders.listDeliveries(user.organizationId, { status: status as DeliveryNoteStatus | undefined });
  }

  @Get('deliveries/:id')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  delivery(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.getDelivery(user.organizationId, id);
  }

  /** The printable conduce, with the signature block for whoever receives the goods. */
  @Get('deliveries/:id/print')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  async print(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const note = await this.orders.getDelivery(user.organizationId, id);
    const company = await organizationFiscalIdentity(this.dataSource.manager, user.organizationId);
    res.header('Content-Type', 'text/html; charset=utf-8').send(deliveryNoteHtml(note, company));
  }

  @Post('deliveries/:id/void')
  @HasPermission(PERMISSIONS.INVOICES_VOID)
  voidDelivery(@Param('id', UuidParamPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.voidDelivery(user.organizationId, id, dto.reason);
  }
}
