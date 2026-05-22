import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { CustomerPaymentsService } from './customer-payments.service';
import { CreateCustomerPaymentDto } from './dto/create-customer-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';

@Controller('customer-payments')
@UseGuards(JwtAuthGuard)
export class CustomerPaymentsController {
  constructor(
    private readonly customerPaymentsService: CustomerPaymentsService,
  ) {}

  @Post()
  create(@Body() createCustomerPaymentDto: CreateCustomerPaymentDto, @CurrentUser() user: User) {
    return this.customerPaymentsService.create(createCustomerPaymentDto, user.organizationId);
  }
}