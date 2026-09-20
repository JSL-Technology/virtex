import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { clampLimit } from '../common/database/search-term';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  @HasPermission(PERMISSIONS.SUPPLIERS_CREATE)
  create(@Body() createSupplierDto: CreateSupplierDto, @CurrentUser() user: AuthenticatedUser) {
    return this.suppliersService.create(createSupplierDto, user.organizationId);
  }

  /** Los proveedores, acotados por `search` y limitados por `limit`. Ambos opcionales. */
  @Get()
  @HasPermission(PERMISSIONS.SUPPLIERS_VIEW)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.suppliersService.findAll(user.organizationId, {
      search,
      limit: clampLimit(limit),
    });
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.SUPPLIERS_VIEW)
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.suppliersService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.SUPPLIERS_EDIT)
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() updateSupplierDto: UpdateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.update(id, updateSupplierDto, user.organizationId);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.SUPPLIERS_DELETE)
  remove(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.suppliersService.remove(id, user.organizationId);
  }
}