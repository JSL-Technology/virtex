import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { CustomerPaymentsService } from './customer-payments.service';
import { CreateCustomerPaymentDto } from './dto/create-customer-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('customer-payments')
@UseGuards(JwtAuthGuard)
export class CustomerPaymentsController {
  constructor(
    private readonly customerPaymentsService: CustomerPaymentsService,
  ) {}

  @HasPermission(PERMISSIONS.ACCOUNTS_RECEIVABLE_COLLECT)
  @Post()
  create(@Body() createCustomerPaymentDto: CreateCustomerPaymentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.customerPaymentsService.create(createCustomerPaymentDto, user.organizationId);
  }
}