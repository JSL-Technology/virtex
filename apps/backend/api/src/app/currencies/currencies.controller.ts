import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { CurrenciesService } from './currencies.service';
import { CreateCurrencyDto } from './dto/create-currency.dto';
import { UpdateCurrencyDto } from './dto/update-currency.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@UseGuards(JwtAuthGuard)
@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currenciesService: CurrenciesService) {}

  @Post()
  @HasPermission(PERMISSIONS.CURRENCIES_MANAGE)
  create(@Body() createCurrencyDto: CreateCurrencyDto) {
    return this.currenciesService.create(createCurrencyDto);
  }

  @Get()
  @HasPermission(PERMISSIONS.CURRENCIES_VIEW)
  findAll() {
    return this.currenciesService.findAll();
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.CURRENCIES_VIEW)
  findOne(@Param('id') id: string) {
    return this.currenciesService.findOne(id);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.CURRENCIES_MANAGE)
  update(
    @Param('id') id: string,
    @Body() updateCurrencyDto: UpdateCurrencyDto,
  ) {
    return this.currenciesService.update(id, updateCurrencyDto);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.CURRENCIES_MANAGE)
  remove(@Param('id') id: string) {
    return this.currenciesService.remove(id);
  }
}