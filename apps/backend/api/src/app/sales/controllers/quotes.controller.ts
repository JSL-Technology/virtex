import { Controller, Post, Body, UseGuards, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { QuotesService } from '../services/quotes.service';
import { CreateQuoteDto } from '../dto/create-quote.dto';

@Controller('sales/quotes')
@UseGuards(JwtAuthGuard)
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Post()
  create(@Body() createDto: CreateQuoteDto, @CurrentUser() user: User) {
    return this.quotesService.create(createDto, user.organizationId, user);
  }

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.quotesService.findAll(user.organizationId);
  }

  @Post(':id/convert-to-invoice')
  convertToInvoice(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.quotesService.convertToInvoice(id, user.organizationId);
  }
}