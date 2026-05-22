
import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { CustomerGroupsService } from './customer-groups.service';
import { CreateCustomerGroupDto } from './dto/create-customer-group.dto';
import { UpdateCustomerGroupDto } from './dto/update-customer-group.dto';

@Controller('customer-groups')
@UseGuards(JwtAuthGuard)
export class CustomerGroupsController {
  constructor(private readonly customerGroupsService: CustomerGroupsService) {}

  @Post()
  create(@Body() createDto: CreateCustomerGroupDto, @CurrentUser() user: User) {
    return this.customerGroupsService.create(createDto, user.organizationId);
  }

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.customerGroupsService.findAll(user.organizationId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.customerGroupsService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updateDto: UpdateCustomerGroupDto, @CurrentUser() user: User) {
    return this.customerGroupsService.update(id, updateDto, user.organizationId);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.customerGroupsService.remove(id, user.organizationId);
  }
}