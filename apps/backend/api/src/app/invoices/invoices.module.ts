import { InvoicesCopilotTools } from './invoices.copilot-tools';
import { InvoicesDataTransferProvider, SalesLinesDataTransferProvider } from './invoices-data-transfer.provider';
import { PriceListsModule } from '../price-lists/price-lists.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { InvoicePostingService } from './services/invoice-posting.service';
import { TenantWithholdingRegime } from '../localization/fiscal/entities/tenant-withholding-regime.entity';
// Sales tax in the markets with no national rate: the rate follows the delivery address, not the
// product, and it used to come off the request unchecked.
import { LocalizationModule } from '../localization/localization.module';
import { InvoiceRendererService } from './services/invoice-renderer.service';
import { FiscalNumberingModule } from './adapters/fiscal-numbering.module';
import { InvoiceIssuedFiscalNumbers } from './issued-fiscal-numbers.source';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLineItem } from './entities/invoice-line-item.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { AuthModule } from '../auth/auth.module';
import { CustomersModule } from '../customers/customers.module';
import { InventoryModule } from '../inventory/inventory.module';
import { TaxesModule } from '../taxes/taxes.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PeriodLockModule } from '../accounting/period-lock.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { SharedModule } from '../shared/shared.module';
import { EinvoicingModule } from '../einvoicing/einvoicing.module';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { WithholdingModule } from '../localization/fiscal/withholding.module';
import { SalesInboxProvider } from './inbox/sales-inbox.provider';

import { MailModule } from '../mail/mail.module';
@Module({
  imports: [
    // Sending an invoice to the customer by e-mail (QA A-09).
    MailModule,
    WithholdingModule,
    TypeOrmModule.forFeature([
      Invoice,
      InvoiceLineItem,
      Organization,
      TenantWithholdingRegime,
    ]),
    AuthModule,
    LocalizationModule,
    CustomersModule,
    InventoryModule,
    TaxesModule,
    ComplianceModule,
    AccountingModule,
    PeriodLockModule,
    CurrenciesModule,
    // FAC-PL-01: lines are priced from the customer's list, then the default list, then the catalogue.
    PriceListsModule,
    // Neither JournalEntriesModule nor SharedModule import InvoicesModule — forwardRef was defensive.
    JournalEntriesModule,
    EinvoicingModule,
    // One numbering engine for every market, guided by the market's own rule (markets/<cc>/documents.ts).
    FiscalNumberingModule,
    SharedModule,
  ],
  controllers: [InvoicesController],
  providers: [InvoicesCopilotTools, 
    SalesInboxProvider,
    InvoicesDataTransferProvider,
    SalesLinesDataTransferProvider,
    InvoicesService,
    InvoicePostingService,
    // Withholding is resolved from the parties and the sale, never taken from the request.
    InvoiceRendererService,
    // The numbers already on invoices, for the ranges registered after them.
    InvoiceIssuedFiscalNumbers,
  ],
  // The renderer is exported for collections, which attaches the invoice PDF to a reminder.
  exports: [InvoicesService, InvoicePostingService, InvoiceRendererService],
})
export class InvoicesModule {}
