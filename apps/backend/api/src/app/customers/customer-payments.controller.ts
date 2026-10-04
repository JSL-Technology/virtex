import { BranchScoped } from '../organizations/contracts/branch-scope.interceptor';
import { CustomerPayment } from './entities/customer-payment.entity';
import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { CustomerPaymentsService } from './customer-payments.service';
import {
  CreateCustomerPaymentDto,
  VoidCustomerPaymentDto,
} from './dto/create-customer-payment.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { PeriodLockGuard } from '../accounting/guards/period-lock.guard';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';

/**
 * Customer receipts.
 *
 * This controller had exactly one route: `POST`. There was no way to list receipts, fetch one, or
 * reverse one — and the receipt list screen in the client called `GET /customer-payments`, which
 * simply did not exist, so the page failed on every load.
 */
@ApiTags('Accounts Receivable')
@ApiBearerAuth()
@Controller('customer-payments')
// Every `:id` here is one of these documents: acting on it needs access to its branch.
@BranchScoped(CustomerPayment)
export class CustomerPaymentsController {
  constructor(private readonly customerPaymentsService: CustomerPaymentsService) {}

  @Post()
  @Idempotent()
  @UseGuards(PeriodLockGuard)
  @HasPermission(PERMISSIONS.ACCOUNTS_RECEIVABLE_COLLECT)
  @ApiOperation({
    summary:
      'Registra un cobro: aplicación a facturas, retenciones, descuento, anticipo y diferencia cambiaria.',
  })
  create(
    @Body() dto: CreateCustomerPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customerPaymentsService.create(dto, user.organizationId, user.id);
  }

  @Get()
  @HasPermission(PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW)
  @ApiOperation({ summary: 'Lista los cobros registrados.' })
  @ApiQuery({ name: 'customerId', required: false, type: String })
  @ApiQuery({ name: 'branchId', required: false, type: String })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('customerId') customerId?: string,
    @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string,
  ) {
    return this.customerPaymentsService.findAll(user.organizationId, customerId, { branchId, actorUserId: user.id });
  }

  @Get('aging')
  @HasPermission(PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW)
  @ApiOperation({ summary: 'Antigüedad de saldos por cliente.' })
  @ApiQuery({ name: 'asOfDate', required: false, type: String })
  aging(
    @CurrentUser() user: AuthenticatedUser,
    @Query('asOfDate') asOfDate?: string,
    @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string,
  ) {
    return this.customerPaymentsService.aging(user.organizationId, asOfDate ?? new Date(), {
      branchId,
      actorUserId: user.id,
    });
  }

  @Get('advances/:customerId')
  @HasPermission(PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW)
  @ApiOperation({
    summary: 'Anticipos disponibles de un cliente, por moneda, para aplicarlos a una factura.',
  })
  advances(
    @Param('customerId', UuidParamPipe) customerId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customerPaymentsService.advances(user.organizationId, customerId);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW)
  findOne(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customerPaymentsService.findOne(id, user.organizationId, user.id);
  }

  @Post(':id/void')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.ACCOUNTS_RECEIVABLE_VOID)
  @ApiOperation({
    summary: 'Anula un cobro y repone el saldo de las facturas — cheque devuelto o error.',
  })
  voidPayment(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: VoidCustomerPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customerPaymentsService.voidPayment(
      id,
      dto,
      user.organizationId,
      user.id,
    );
  }
}
