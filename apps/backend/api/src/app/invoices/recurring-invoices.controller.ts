import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { RecurringInvoicesService } from './recurring-invoices.service';
import { CreateRecurringInvoiceDto, UpdateRecurringInvoiceDto } from './dto/recurring-invoice.dto';
import { RecurringStatus } from './entities/recurring-invoice.entity';

/** Invoices issued on a schedule. Changing what is billed takes `invoices:create`. */
@Controller('invoices/recurring')
export class RecurringInvoicesController {
  constructor(private readonly recurring: RecurringInvoicesService) {}

  @Get()
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.recurring.list(user.organizationId);
  }

  @Post()
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  create(@Body() dto: CreateRecurringInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.recurring.create(dto, user.organizationId, user.id);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  get(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recurring.get(user.organizationId, id);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  update(@Param('id', UuidParamPipe) id: string, @Body() dto: UpdateRecurringInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.recurring.update(user.organizationId, id, dto);
  }

  @Get(':id/runs')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  runs(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recurring.runs(user.organizationId, id);
  }

  @Post(':id/pause')
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  pause(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recurring.setStatus(user.organizationId, id, RecurringStatus.PAUSED);
  }

  @Post(':id/resume')
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  resume(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recurring.setStatus(user.organizationId, id, RecurringStatus.ACTIVE);
  }

  @Post(':id/end')
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  end(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recurring.setStatus(user.organizationId, id, RecurringStatus.ENDED);
  }

  /** Issue the next due invoice now, instead of waiting for its date. */
  @Post(':id/run')
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  run(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recurring.runNow(user.organizationId, id);
  }
}
