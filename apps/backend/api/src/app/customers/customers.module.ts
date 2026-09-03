
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { Customer } from './entities/customer.entity';
import { AuthModule } from '../auth/auth.module';
import { CustomerPayment } from './entities/customer-payment.entity';
import { CustomerPaymentLine } from './entities/customer-payment-line.entity';
import { CustomerPaymentsController } from './customer-payments.controller';
import { CustomerPaymentsService } from './customer-payments.service';
import { AccountingPeriod } from '../accounting/entities/accounting-period.entity';
import { AccountPeriodLock } from '../accounting/entities/account-period-lock.entity';
import { PeriodLockGuard } from '../accounting/guards/period-lock.guard';
import { CurrenciesModule } from '../currencies/currencies.module';
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
    CurrenciesModule,
    TypeOrmModule.forFeature([
      Customer,
      CustomerPayment,
      CustomerPaymentLine,
      AccountingPeriod,
      AccountPeriodLock,
      Invoice,
      OrganizationSettings,
      CustomerContact,
      CustomerAddress,
      CustomerGroup,
    ]),
    AuthModule,
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
    PeriodLockGuard,
    CustomerGroupsService,
  ],
  exports: [CustomersService],
})
export class CustomersModule {}