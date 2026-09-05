import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { InvoicePostingService } from './services/invoice-posting.service';
import { InvoiceRendererService } from './services/invoice-renderer.service';
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
import { CurrenciesModule } from '../currencies/currencies.module';
import { SharedModule } from '../shared/shared.module';
import { EinvoicingModule } from '../einvoicing/einvoicing.module';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Invoice,
      InvoiceLineItem,
      AccountingPeriod,
      AccountPeriodLock,
      Organization,
      OrganizationSettings,
    ]),
    AuthModule,
    CustomersModule,
    InventoryModule,
    TaxesModule,
    ComplianceModule,
    AccountingModule,
    CurrenciesModule,
    // A sale posts to the ledger in the same transaction that creates it. Without this import the
    // invoice module could not reach the posting service at all, which is how issuing an invoice
    // came to record nothing in the books.
    forwardRef(() => JournalEntriesModule),
    EinvoicingModule,
    forwardRef(() => SharedModule),
  ],
  controllers: [InvoicesController],
  providers: [
    InvoicesService,
    InvoicePostingService,
    InvoiceRendererService,
    GenericFiscalAdapter,
    DominicanRepublicFiscalAdapter,
    FiscalAdapterFactory,
  ],
  exports: [InvoicesService, InvoicePostingService],
})
export class InvoicesModule {}
