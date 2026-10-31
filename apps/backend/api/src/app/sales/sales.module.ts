import { OrderMailHandler } from './inbox/order-mail.handler';
import { SalesCopilotTools } from './sales.copilot-tools';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { LeadsController } from './controllers/leads.controller';
import { OpportunitiesController } from './controllers/opportunities.controller';
import { Lead } from './entities/lead.entity';
import { Opportunity } from './entities/opportunity.entity';
import { LeadsService } from './services/leads.service';
import { OpportunitiesService } from './services/opportunities.service';


import { Quote } from './entities/quote.entity';
import { QuoteLine } from './entities/quote-line.entity';
import { Activity } from './entities/activity.entity';
import { QuotesController } from './controllers/quotes.controller';
import { QuotesService } from './services/quotes.service';
import { SharedModule } from '../shared/shared.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { AuthModule } from '../auth/auth.module';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { CurrenciesModule } from '../currencies/currencies.module';
import { Customer } from '../customers/entities/customer.entity';
import { InventoryModule } from '../inventory/inventory.module';
import { SalesOrder } from './entities/sales-order.entity';
import { SalesOrderLine } from './entities/sales-order-line.entity';
import { DeliveryNote } from './entities/delivery-note.entity';
import { DeliveryNoteLine } from './entities/delivery-note-line.entity';
import { SalesOrdersController } from './controllers/sales-orders.controller';
import { SalesOrdersService } from './services/sales-orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Lead, 
      Opportunity,
      Quote,
      QuoteLine,
      Activity,
      OrganizationSettings,
      // `LeadsService` injects the customer repository directly. The module never declared it,
      // which nothing noticed because the module itself was never loaded by the application.
      Customer,
      SalesOrder,
      SalesOrderLine,
      DeliveryNote,
      DeliveryNoteLine,
    ]),
    AuthModule,
    CustomersModule,
    SharedModule,
    InvoicesModule,
    CurrenciesModule,
    InventoryModule,
  ],
  controllers: [
    LeadsController, 
    OpportunitiesController,
    QuotesController,
    SalesOrdersController,
  ],
  providers: [
    // Customer orders received at the company's address (inbound-mail) become draft quotes.
    OrderMailHandler,SalesCopilotTools, 
    LeadsService,
    OpportunitiesService,
    QuotesService,
    SalesOrdersService,
  ],
  exports: [QuotesService, SalesOrdersService],
})
export class SalesModule {}