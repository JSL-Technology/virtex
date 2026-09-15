import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AccountsPayableService } from './accounts-payable.service';
import { CreateVendorBillDto } from './dto/create-vendor-bill.dto';
import { UpdateVendorBillDto } from './dto/update-vendor-bill.dto';
import { PayVendorBillsDto } from './dto/pay-vendor-bills.dto';
import { VoidVendorBillDto } from './dto/void-vendor-bill.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { PeriodLockGuard } from '../accounting/guards/period-lock.guard';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';

@ApiTags('Accounts Payable')
@ApiBearerAuth()
@Controller('accounts-payable')
export class AccountsPayableController {
  constructor(private readonly accountsPayableService: AccountsPayableService) {}

  @Post()
  @UseGuards(PeriodLockGuard)
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_CREATE)
  @ApiOperation({ summary: 'Registra una factura de proveedor en borrador.' })
  create(
    @Body() createVendorBillDto: CreateVendorBillDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsPayableService.create(createVendorBillDto, user.organizationId);
  }

  @Get()
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VIEW)
  @ApiOperation({ summary: 'Lista las facturas de proveedor.' })
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.accountsPayableService.findAll(user.organizationId);
  }

  /**
   * What is owed, by supplier and by how overdue it is.
   *
   * There was no ageing report for payables or receivables anywhere in the product. It is the
   * report a treasurer opens to decide what to pay next.
   */
  @Get('aging')
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VIEW)
  @ApiOperation({ summary: 'Antigüedad de saldos por proveedor.' })
  @ApiQuery({ name: 'asOfDate', required: false, type: String })
  aging(@CurrentUser() user: AuthenticatedUser, @Query('asOfDate') asOfDate?: string) {
    return this.accountsPayableService.aging(
      user.organizationId,
      asOfDate ?? new Date(),
    );
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VIEW)
  findOne(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsPayableService.findOne(id, user.organizationId);
  }

  @Get(':id/payments')
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VIEW)
  @ApiOperation({ summary: 'Pagos aplicados a una factura de proveedor.' })
  listPayments(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsPayableService.listPayments(id, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_EDIT)
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() updateVendorBillDto: UpdateVendorBillDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsPayableService.update(
      id,
      updateVendorBillDto,
      user.organizationId,
    );
  }

  @Post(':id/submit-for-approval')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_APPROVE)
  @ApiOperation({
    summary: 'Envía la factura a aprobación, o la contabiliza si no requiere flujo.',
  })
  submitForApproval(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsPayableService.submitForApproval(
      id,
      user.organizationId,
      user.id,
    );
  }

  /**
   * Settle one or more bills.
   *
   * This route did not exist. `createPaymentBatch` was in the service, exposed by no controller and
   * called by nothing, so there was no way to pay a supplier invoice through the API at all.
   */
  @Post('payments')
  @Idempotent()
  @UseGuards(PeriodLockGuard)
  @HttpCode(HttpStatus.CREATED)
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_PAY)
  @ApiOperation({
    summary:
      'Paga facturas de proveedor: parcial o total, con retenciones, descuento y diferencia cambiaria.',
  })
  payBills(@Body() dto: PayVendorBillsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.accountsPayableService.payBills(dto, user.organizationId, user.id);
  }

  @Post(':id/void')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VOID)
  voidBill(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: VoidVendorBillDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsPayableService.voidBill(id, user.organizationId, dto, user.id);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VOID)
  @ApiOperation({ summary: 'No permitido: una factura se anula, no se borra.' })
  remove() {
    return this.accountsPayableService.remove();
  }
}
