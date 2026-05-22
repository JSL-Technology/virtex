
import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { PriceListsService } from './price-lists.service';
import { CreatePriceListDto } from './dto/create-price-list.dto';
import { UpdatePriceListDto } from './dto/update-price-list.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';

@Controller('price-lists')
@UseGuards(JwtAuthGuard)
export class PriceListsController {
  constructor(private readonly priceListsService: PriceListsService) {}

  @Post()
  create(@Body() createPriceListDto: CreatePriceListDto, @CurrentUser() user: User) {
    return this.priceListsService.create(createPriceListDto, user.organizationId);
  }

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.priceListsService.findAll(user.organizationId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.priceListsService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updatePriceListDto: UpdatePriceListDto, @CurrentUser() user: User) {
    return this.priceListsService.update(id, updatePriceListDto, user.organizationId);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.priceListsService.remove(id, user.organizationId);
  }
}