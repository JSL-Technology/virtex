import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('suppliers')
@UseGuards(JwtAuthGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  @HasPermission(PERMISSIONS.SUPPLIERS_CREATE)
  create(@Body() createSupplierDto: CreateSupplierDto, @CurrentUser() user: AuthenticatedUser) {
    return this.suppliersService.create(createSupplierDto, user.organizationId);
  }

  @Get()
  @HasPermission(PERMISSIONS.SUPPLIERS_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.suppliersService.findAll(user.organizationId);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.SUPPLIERS_VIEW)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.suppliersService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.SUPPLIERS_EDIT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateSupplierDto: UpdateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.update(id, updateSupplierDto, user.organizationId);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.SUPPLIERS_DELETE)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.suppliersService.remove(id, user.organizationId);
  }
}