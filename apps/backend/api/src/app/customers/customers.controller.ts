
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
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@Controller('customers')
@UseGuards(JwtAuthGuard)
/**
 * Customers. The permissions existed in the catalogue and were declared on no route here.
 */
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @HasPermission(PERMISSIONS.CUSTOMERS_CREATE)
  create(@Body() createCustomerDto: CreateCustomerDto, @CurrentUser() user: AuthenticatedUser) {
    return this.customersService.create(createCustomerDto, user.organizationId);
  }

  @Get()
  @HasPermission(PERMISSIONS.CUSTOMERS_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.customersService.findAll(user.organizationId);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.CUSTOMERS_VIEW)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.customersService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.CUSTOMERS_EDIT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customersService.update(id, updateCustomerDto, user.organizationId);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.CUSTOMERS_DELETE)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.customersService.remove(id, user.organizationId);
  }
}