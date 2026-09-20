
import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { InventoryService } from './inventory.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { clampLimit } from '../common/database/search-term';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  @HasPermission(PERMISSIONS.PRODUCTS_CREATE)
  create(@Body() createProductDto: CreateProductDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.create(createProductDto, user.organizationId, user.id);
  }

  /**
   * El catálogo, acotado por `search` y limitado por `limit`.
   *
   * Ambos opcionales; omitirlos es lo que esta ruta ha hecho siempre. Existen para los selectores
   * de producto, que no tienen por qué descargarse el catálogo entero para enseñar diez filas.
   */
  @Get()
  @HasPermission(PERMISSIONS.PRODUCTS_VIEW)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.inventoryService.findAll(user.organizationId, {
      search,
      limit: clampLimit(limit),
    });
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