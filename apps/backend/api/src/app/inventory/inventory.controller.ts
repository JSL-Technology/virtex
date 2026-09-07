
import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  @HasPermission(PERMISSIONS.PRODUCTS_CREATE)
  create(@Body() createProductDto: CreateProductDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.create(createProductDto, user.organizationId);
  }

  @Get()
  @HasPermission(PERMISSIONS.PRODUCTS_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.findAll(user.organizationId);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.PRODUCTS_VIEW)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.PRODUCTS_EDIT)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updateProductDto: UpdateProductDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.update(id, updateProductDto, user.organizationId);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.PRODUCTS_DELETE)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.remove(id, user.organizationId);
  }
}