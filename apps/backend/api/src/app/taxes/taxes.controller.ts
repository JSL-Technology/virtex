import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { TaxesService } from './taxes.service';
import { CreateTaxDto } from './dto/create-tax.dto';
import { UpdateTaxDto } from './dto/update-tax.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('taxes')
@UseGuards(JwtAuthGuard)
export class TaxesController {
  constructor(private readonly taxesService: TaxesService) {}

  @HasPermission(PERMISSIONS.TAXES_CREATE)
  @Post()
  create(@Body() createTaxDto: CreateTaxDto, @CurrentUser() user: AuthenticatedUser) {
    return this.taxesService.create(createTaxDto, user.organizationId);
  }

  @HasPermission(PERMISSIONS.TAXES_VIEW)
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.taxesService.findAll(user.organizationId);
  }

  @HasPermission(PERMISSIONS.TAXES_VIEW)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.taxesService.findOne(id, user.organizationId);
  }

  @HasPermission(PERMISSIONS.TAXES_EDIT)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updateTaxDto: UpdateTaxDto, @CurrentUser() user: AuthenticatedUser) {
    return this.taxesService.update(id, updateTaxDto, user.organizationId);
  }

  @HasPermission(PERMISSIONS.TAXES_DELETE)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.taxesService.remove(id, user.organizationId);
  }
}