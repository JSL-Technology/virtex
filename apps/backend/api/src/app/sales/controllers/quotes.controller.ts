import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { HasPermission } from '../../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../../shared/permissions';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { User } from '../../users/entities/user.entity/user.entity';
import { QuotesService } from '../services/quotes.service';
import { CreateQuoteDto } from '../dto/create-quote.dto';
import { AuthenticatedUser } from '../../security/principal';
import { Idempotent } from '../../shared/idempotency/idempotent.decorator';

@Controller('sales/quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Post()
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  create(@Body() createDto: CreateQuoteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.quotesService.create(createDto, user.organizationId, user);
  }

  @Get()
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.quotesService.findAll(user.organizationId);
  }

  @Post(':id/convert-to-invoice')
  @Idempotent()
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  convertToInvoice(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.quotesService.convertToInvoice(id, user.organizationId);
  }
}