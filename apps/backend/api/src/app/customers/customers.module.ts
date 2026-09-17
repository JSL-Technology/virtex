
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
import { CurrenciesModule } from '../currencies/currencies.module';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { CustomerContact } from './entities/customer-contact.entity';
import { CustomerAddress } from './entities/customer-address.entity';
import { CustomerGroup } from './entities/customer-group.entity';
import { CustomerGroupsController } from './customer-groups.controller';
import { CustomerGroupsService } from './customer-groups.service';
// The ageing report ties itself to the receivables control account in the general ledger.
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
// PeriodLockModule provides PeriodLockGuard and the AccountingPeriod/AccountPeriodLock
// repositories it needs — no need to register them here and claim ownership.
import { PeriodLockModule } from '../accounting/period-lock.module';
import { LocalizationProvisioningModule } from '../localization/localization-provisioning.module';

@Module({
  imports: [
    CurrenciesModule,
    // Only entities this module owns.
    TypeOrmModule.forFeature([
      Customer,
      CustomerPayment,
      CustomerPaymentLine,
      CustomerContact,
      CustomerAddress,
      CustomerGroup,
    ]),
    AuthModule,
    JournalEntriesModule,
    ChartOfAccountsModule,
    // AccountingPeriod/AccountPeriodLock owned by accounting; get the guard from its leaf module.
    PeriodLockModule,
    // The identity-document catalogue: customers' tax ids were stored with no type and no
    // validation at all, in a product whose purpose is fiscal compliance.
    LocalizationProvisioningModule,
    // Invoice and OrganizationSettings are read via DataSource.manager in CustomerPaymentsService.
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
    // PeriodLockGuard is provided by PeriodLockModule (imported above).
  ],
  exports: [CustomersService],
})
export class CustomersModule {}