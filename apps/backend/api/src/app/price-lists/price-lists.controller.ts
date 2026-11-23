
import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { PriceListsService } from './price-lists.service';
import { CreatePriceListDto } from './dto/create-price-list.dto';
import { UpdatePriceListDto } from './dto/update-price-list.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { ResolvePricesDto } from './dto/resolve-prices.dto';
import { PriceResolver } from './price-resolver.service';
import { organizationBaseCurrency } from '../organizations/contracts/base-currency.contract';
import { organizationToday } from '../organizations/contracts/fiscal-today.contract';
import { DataSource } from 'typeorm';

@Controller('price-lists')
export class PriceListsController {
  constructor(
    private readonly priceListsService: PriceListsService,
    private readonly pricing: PriceResolver,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * The prices a document being composed will be charged at: the customer's list, the default
   * list for the currency, then the catalogue. Behind `products:view`, not `price_lists:view`: a
   * seller who can pick a product must see the price the invoice will carry, and this reveals no
   * more than that.
   */
  @Post('resolve')
  @HasPermission(PERMISSIONS.PRODUCTS_VIEW)
  async resolve(@Body() dto: ResolvePricesDto, @CurrentUser() user: AuthenticatedUser) {
    const manager = this.dataSource.manager;
    const organizationId = user.organizationId;
    return this.pricing.priceLines(
      organizationId,
      {
        customerId: dto.customerId ?? null,
        currencyCode: dto.currencyCode ?? (await organizationBaseCurrency(manager, organizationId)),
        date: dto.date?.slice(0, 10) ?? (await organizationToday(manager, organizationId)),
      },
      dto.lines,
    );
  }

  @Post()
  @HasPermission(PERMISSIONS.PRICE_LISTS_CREATE)
  create(@Body() createPriceListDto: CreatePriceListDto, @CurrentUser() user: AuthenticatedUser) {
    return this.priceListsService.create(createPriceListDto, user.organizationId);
  }

  @Get()
  @HasPermission(PERMISSIONS.PRICE_LISTS_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.priceListsService.findAll(user.organizationId);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.PRICE_LISTS_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.priceListsService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.PRICE_LISTS_EDIT)
  update(@Param('id', UuidParamPipe) id: string, @Body() updatePriceListDto: UpdatePriceListDto, @CurrentUser() user: AuthenticatedUser) {
    return this.priceListsService.update(id, updatePriceListDto, user.organizationId);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.PRICE_LISTS_DELETE)
  remove(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.priceListsService.remove(id, user.organizationId);
  }
}