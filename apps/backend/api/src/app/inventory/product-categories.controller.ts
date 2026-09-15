import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { ProductCategoriesService } from './product-categories.service';
import {
  CreateProductCategoryDto,
  UpdateProductCategoryDto,
} from './dto/product-category.dto';

/**
 * The product-category master.
 *
 * Reading is gated on `products:view` rather than on a permission of its own: anybody who can see
 * the catalogue needs to see how it is filed, and a separate permission would be one more thing to
 * forget to grant. Writing needs `products:edit`, the same right that changes what a product is.
 */
@Controller('inventory/categories')
export class ProductCategoriesController {
  constructor(private readonly categories: ProductCategoriesService) {}

  @Get()
  @HasPermission(PERMISSIONS.PRODUCTS_VIEW)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.categories.findAll(user.organizationId, includeInactive === 'true');
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.PRODUCTS_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.categories.findOne(id, user.organizationId);
  }

  @Post()
  @HasPermission(PERMISSIONS.PRODUCTS_EDIT)
  create(@Body() dto: CreateProductCategoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.categories.create(dto, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.PRODUCTS_EDIT)
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdateProductCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.categories.update(id, dto, user.organizationId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.PRODUCTS_EDIT)
  remove(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.categories.remove(id, user.organizationId);
  }
}
