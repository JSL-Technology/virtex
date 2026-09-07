
import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { PriceListsService } from './price-lists.service';
import { CreatePriceListDto } from './dto/create-price-list.dto';
import { UpdatePriceListDto } from './dto/update-price-list.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('price-lists')
@UseGuards(JwtAuthGuard)
export class PriceListsController {
  constructor(private readonly priceListsService: PriceListsService) {}

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
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.priceListsService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.PRICE_LISTS_EDIT)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updatePriceListDto: UpdatePriceListDto, @CurrentUser() user: AuthenticatedUser) {
    return this.priceListsService.update(id, updatePriceListDto, user.organizationId);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.PRICE_LISTS_DELETE)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.priceListsService.remove(id, user.organizationId);
  }
}