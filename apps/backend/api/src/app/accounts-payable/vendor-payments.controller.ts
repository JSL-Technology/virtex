import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';
import { BranchScoped } from '../organizations/contracts/branch-scope.interceptor';
import { PaymentBatch } from './entities/payment-batch.entity';
import { VendorPaymentsService } from './vendor-payments.service';
import { VendorPaymentQueryDto } from './dto/vendor-payment-query.dto';
import { VoidVendorPaymentDto } from './dto/void-vendor-payment.dto';

/**
 * Payments made to suppliers. Making one is `POST /accounts-payable/payments`; these are the list,
 * the document and its void.
 */
@ApiTags('Accounts Payable')
@ApiBearerAuth()
@Controller('vendor-payments')
// Every `:id` here is one of these documents: acting on it needs access to its branch.
@BranchScoped(PaymentBatch)
export class VendorPaymentsController {
  constructor(private readonly payments: VendorPaymentsService) {}

  @Get()
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VIEW)
  @ApiOperation({ summary: 'Lista los pagos a proveedores: cuenta, facturas, proveedores, estado.' })
  findAll(@Query() query: VendorPaymentQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payments.findAll(user.organizationId, query, user.id);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.payments.findOne(id, user.organizationId, user.id);
  }

  @Post(':id/void')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VOID)
  @ApiOperation({ summary: 'Anula un pago: las facturas vuelven a deber lo pagado y el asiento se revierte.' })
  voidPayment(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: VoidVendorPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.voidPayment(id, dto, user.organizationId, user.id);
  }
}
