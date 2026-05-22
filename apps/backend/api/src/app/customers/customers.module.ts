
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { Customer } from './entities/customer.entity';
import { AuthModule } from '../auth/auth.module';
import { CustomerPayment } from './entities/customer-payment.entity';
import { CustomerPaymentLine } from './entities/customer-payment-line.entity';
import { CustomerPaymentsController } from './customer-payments.controller';
import { CustomerPaymentsService } from './customer-payments.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { CustomerContact } from './entities/customer-contact.entity';
import { CustomerAddress } from './entities/customer-address.entity';
import { CustomerGroup } from './entities/customer-group.entity';

import { CustomerGroupsController } from './customer-groups.controller';
import { CustomerGroupsService } from './customer-groups.service';


@Module({
  imports: [
    TypeOrmModule.forFeature([
      Customer,
      CustomerPayment,
      CustomerPaymentLine,
      Invoice,
      OrganizationSettings,
      CustomerContact,
      CustomerAddress,
      CustomerGroup,
    ]),
    AuthModule,
    forwardRef(() => InvoicesModule),
    JournalEntriesModule,
  ],
  controllers: [
    CustomersController,
    CustomerPaymentsController,
    CustomerGroupsController,
  ],
  providers: [
    CustomersService,
    CustomerPaymentsService,
    CustomerGroupsService,
  ],
  exports: [CustomersService],
})
export class CustomersModule {}