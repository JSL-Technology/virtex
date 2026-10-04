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
import { HasPermission } from '../security/decorators/permissions.decorator';
import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';
import { RequiresPlatformPermission } from '../security/decorators/platform-permission.decorator';
import { PLATFORM_PERMISSIONS } from '../security/platform-permissions';
import { PERMISSIONS } from '../shared/permissions';

@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currenciesService: CurrenciesService) {}

  @Post()
  @HasPermission(PERMISSIONS.CURRENCIES_MANAGE)
  // The currency catalogue is shared by every tenant.
  @RequiresPlatformPermission(PLATFORM_PERMISSIONS.REFERENCE_DATA_MANAGE)
  create(@Body() createCurrencyDto: CreateCurrencyDto) {
    return this.currenciesService.create(createCurrencyDto);
  }

  @Get()
  @AuthenticatedOnly(
    'Currency codes, names and symbols are reference data every document form needs: a seller raising an invoice got 403 and an empty currency picker (QA M-01).',
  )
  findAll() {
    return this.currenciesService.findAll();
  }

  @Get(':id')
  @AuthenticatedOnly(
    'One currency of the shared reference list, read by any document form that names it; writing the list still requires currencies:manage.',
  )
  findOne(@Param('id') id: string) {
    return this.currenciesService.findOne(id);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.CURRENCIES_MANAGE)
  // The currency catalogue is shared by every tenant.
  @RequiresPlatformPermission(PLATFORM_PERMISSIONS.REFERENCE_DATA_MANAGE)
  update(
    @Param('id') id: string,
    @Body() updateCurrencyDto: UpdateCurrencyDto,
  ) {
    return this.currenciesService.update(id, updateCurrencyDto);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.CURRENCIES_MANAGE)
  // The currency catalogue is shared by every tenant.
  @RequiresPlatformPermission(PLATFORM_PERMISSIONS.REFERENCE_DATA_MANAGE)
  remove(@Param('id') id: string) {
    return this.currenciesService.remove(id);
  }
}