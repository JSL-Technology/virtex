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
    ]),
    AuthModule,
    CustomersModule,
    SharedModule,
    InvoicesModule,
    CurrenciesModule,
  ],
  controllers: [
    LeadsController, 
    OpportunitiesController,
    QuotesController,
  ],
  providers: [
    LeadsService,
    OpportunitiesService,
    QuotesService,
  ],
  exports: [QuotesService],
})
export class SalesModule {}