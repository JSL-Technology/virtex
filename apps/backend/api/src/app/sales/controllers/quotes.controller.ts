import { Controller, Post, Body, UseGuards, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { HasPermission } from '../../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../../shared/permissions';
import { JwtAuthGuard } from '../../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { User } from '../../users/entities/user.entity/user.entity';
import { QuotesService } from '../services/quotes.service';
import { CreateQuoteDto } from '../dto/create-quote.dto';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';

@Controller('sales/quotes')
@UseGuards(JwtAuthGuard)
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
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  convertToInvoice(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.quotesService.convertToInvoice(id, user.organizationId);
  }
}