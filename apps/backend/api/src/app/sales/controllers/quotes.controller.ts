import { Controller, Post, Body, Get, Param, Patch, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { HasPermission } from '../../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../../shared/permissions';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { QuotesService } from '../services/quotes.service';
import {
  CancelQuoteDto,
  CreateQuoteDto,
  ListQuotesQueryDto,
  QuoteReasonDto,
  UpdateQuoteDto,
} from '../dto/create-quote.dto';
import { AuthenticatedUser } from '../../security/principal';
import { Idempotent } from '../../shared/idempotency/idempotent.decorator';

/**
 * Sales quotes. Reading follows `invoices:view`; writing and every decision, `invoices:create` —
 * a quote is the commercial half of an invoice and the same people make both.
 */
@Controller('sales/quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Post()
  @Idempotent()
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  create(@Body() createDto: CreateQuoteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.quotesService.create(createDto, user.organizationId, user);
  }

  /** The totals the quote would carry, computed by the invoice engine, without saving anything. */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  preview(@Body() dto: CreateQuoteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.quotesService.preview(dto, user.organizationId);
  }

  @Get()
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  findAll(@Query() query: ListQuotesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.quotesService.findAll(user.organizationId, query);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.quotesService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdateQuoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.quotesService.update(id, dto, user.organizationId);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  markSent(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.quotesService.markSent(id, user.organizationId);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  accept(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.quotesService.accept(id, user.organizationId);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  reject(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: QuoteReasonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.quotesService.reject(id, dto.reason, user.organizationId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  cancel(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: CancelQuoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.quotesService.cancel(id, dto.reason, user.organizationId);
  }

  @Post(':id/duplicate')
  @Idempotent()
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  duplicate(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.quotesService.duplicate(id, user.organizationId, user);
  }

  @Post(':id/convert-to-invoice')
  @Idempotent()
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  convertToInvoice(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.quotesService.convertToInvoice(id, user.organizationId);
  }
}
