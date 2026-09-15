
import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { InventoryService } from './inventory.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  @HasPermission(PERMISSIONS.PRODUCTS_CREATE)
  create(@Body() createProductDto: CreateProductDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.create(createProductDto, user.organizationId, user.id);
  }

  @Get()
  @HasPermission(PERMISSIONS.PRODUCTS_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.findAll(user.organizationId);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.PRODUCTS_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.PRODUCTS_EDIT)
  update(@Param('id', UuidParamPipe) id: string, @Body() updateProductDto: UpdateProductDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.update(id, updateProductDto, user.organizationId, user.id);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.PRODUCTS_DELETE)
  remove(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.remove(id, user.organizationId, user.id);
  }
}