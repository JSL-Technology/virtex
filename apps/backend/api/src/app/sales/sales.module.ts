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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Lead, 
      Opportunity,
      Quote,
      QuoteLine,
      Activity,
    ]),
    CustomersModule,
    SharedModule,
    InvoicesModule,
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
})
export class SalesModule {}