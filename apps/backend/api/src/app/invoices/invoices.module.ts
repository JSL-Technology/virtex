













































import { Module, forwardRef } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GenericFiscalAdapter } from './adapters/generic-fiscal.adapter';
import { DominicanRepublicFiscalAdapter } from './adapters/dominican-republic-fiscal.adapter';
import { FiscalAdapterFactory } from './adapters/fiscal-adapter.factory';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLineItem } from './entities/invoice-line-item.entity';
import { AuthModule } from '../auth/auth.module';
import { CustomersModule } from '../customers/customers.module';
import { InventoryModule } from '../inventory/inventory.module';
import { TaxesModule } from '../taxes/taxes.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { AccountingModule } from '../accounting/accounting.module';
import { AccountingPeriod } from '../accounting/entities/accounting-period.entity';
import { AccountPeriodLock } from '../accounting/entities/account-period-lock.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { ExchangeRate } from '../currencies/entities/exchange-rate.entity';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Invoice,
      InvoiceLineItem,

      AccountingPeriod,
      AccountPeriodLock,
      Organization,
      OrganizationSettings,
      ExchangeRate,
    ]),
    AuthModule,
    CustomersModule,
    InventoryModule,
    TaxesModule,
    ComplianceModule,
    AccountingModule,
    forwardRef(() => SharedModule),
  ],
  controllers: [InvoicesController],
  providers: [
    InvoicesService,
    GenericFiscalAdapter,
    DominicanRepublicFiscalAdapter,
    FiscalAdapterFactory,
  ],
  exports: [InvoicesService],
})
export class InvoicesModule {}