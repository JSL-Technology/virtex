import { BranchScoped } from '../organizations/contracts/branch-scope.interceptor';
import { VendorBill } from './entities/vendor-bill.entity';
import { RequireStepUp, StepUpScope } from '../auth/contracts/step-up.contract';
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
  ParseUUIDPipe,
} from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AccountsPayableService } from './accounts-payable.service';
import { CreateVendorBillDto } from './dto/create-vendor-bill.dto';
import { UpdateVendorBillDto } from './dto/update-vendor-bill.dto';
import { PayVendorBillsDto } from './dto/pay-vendor-bills.dto';
import { VoidVendorBillDto } from './dto/void-vendor-bill.dto';
import { ReleaseMatchHoldDto } from './dto/release-match-hold.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { PeriodLockGuard } from '../accounting/guards/period-lock.guard';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';
import { RecordSupplierFiscalNumberDto } from './dto/record-supplier-fiscal-number.dto';
import { RecordPurchaseAttributesDto } from './dto/record-purchase-attributes.dto';

@ApiTags('Accounts Payable')
@ApiBearerAuth()
@Controller('accounts-payable')
// Every `:id` here is one of these documents: acting on it needs access to its branch.
@BranchScoped(VendorBill)
export class AccountsPayableController {
  constructor(private readonly accountsPayableService: AccountsPayableService) {}

  @Post()
  @UseGuards(PeriodLockGuard)
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_CREATE)
  // A retry of the same form (a double click, a dropped connection) replays the first answer
  // instead of recording the supplier's document a second time (AP-03).
  @Idempotent()
  @ApiOperation({ summary: 'Registra una factura de proveedor en borrador.' })
  create(
    @Body() createVendorBillDto: CreateVendorBillDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsPayableService.create(createVendorBillDto, user.organizationId, user.id);
  }

  @Get()
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VIEW)
  @ApiOperation({ summary: 'Lista las facturas de proveedor.' })
  @ApiQuery({ name: 'branchId', required: false, type: String })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string,
  ) {
    return this.accountsPayableService.findAll(user.organizationId, { branchId, actorUserId: user.id });
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
  aging(
    @CurrentUser() user: AuthenticatedUser,
    @Query('asOfDate') asOfDate?: string,
    @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string,
  ) {
    return this.accountsPayableService.aging(user.organizationId, asOfDate ?? new Date(), {
      branchId,
      actorUserId: user.id,
    });
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VIEW)
  findOne(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsPayableService.findOne(id, user.organizationId, user.id);
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
      user.id,
    );
  }

  /**
   * Record the supplier's fiscal document number on a posted bill that has none — the repair a
   * purchases return asks for (QA R3-A04), in whatever market the company is in.
   */
  @Post(':id/supplier-fiscal-number')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_EDIT)
  recordSupplierFiscalNumber(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: RecordSupplierFiscalNumberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsPayableService.recordSupplierFiscalNumber(id, user.organizationId, dto.supplierFiscalNumber);
  }

  /**
   * Answer what the market's authority asks about a purchase, on a bill already posted: the
   * classification is often the accountant's at month end, not the entry clerk's.
   */
  @Patch(':id/fiscal-attributes')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_EDIT)
  recordFiscalAttributes(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: RecordPurchaseAttributesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsPayableService.recordFiscalAttributes(id, user.organizationId, dto.fiscalAttributes);
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
   * Release a bill held by the three-way match, with the reason, and submit it (CMP-01). Not the
   * person who submitted it.
   */
  @Post(':id/release-match-hold')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_APPROVE)
  @ApiOperation({ summary: 'Libera una factura retenida por el cotejo de tres vías y la envía a aprobación.' })
  releaseMatchHold(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: ReleaseMatchHoldDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsPayableService.releaseMatchHold(id, user.organizationId, user.id, dto.reason);
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
  // Money leaving the tenant: the same re-authentication payroll payment already asks for.
  @RequireStepUp(StepUpScope.MOVE_FUNDS)
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
