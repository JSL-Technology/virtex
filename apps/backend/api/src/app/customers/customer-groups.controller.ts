
import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { CustomerGroupsService } from './customer-groups.service';
import { CreateCustomerGroupDto } from './dto/create-customer-group.dto';
import { UpdateCustomerGroupDto } from './dto/update-customer-group.dto';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@Controller('customer-groups')
@UseGuards(JwtAuthGuard)
export class CustomerGroupsController {
  constructor(private readonly customerGroupsService: CustomerGroupsService) {}

  @Post()
  @HasPermission(PERMISSIONS.CUSTOMERS_CREATE)
  create(@Body() createDto: CreateCustomerGroupDto, @CurrentUser() user: AuthenticatedUser) {
    return this.customerGroupsService.create(createDto, user.organizationId);
  }

  @Get()
  @HasPermission(PERMISSIONS.CUSTOMERS_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.customerGroupsService.findAll(user.organizationId);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.CUSTOMERS_VIEW)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.customerGroupsService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.CUSTOMERS_EDIT)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updateDto: UpdateCustomerGroupDto, @CurrentUser() user: AuthenticatedUser) {
    return this.customerGroupsService.update(id, updateDto, user.organizationId);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.CUSTOMERS_DELETE)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.customerGroupsService.remove(id, user.organizationId);
  }
}