
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinancialReportingController } from './financial-reporting.controller';
import { FinancialReportingService } from './financial-reporting.service';

import { Account } from '../chart-of-accounts/entities/account.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';

@Module({
  imports: [
    ChartOfAccountsModule,

    TypeOrmModule.forFeature([
      Account,
      JournalEntryLine,
      OrganizationSettings,
      Invoice,
    ]),
  ],
  controllers: [FinancialReportingController],
  providers: [FinancialReportingService],

  exports: [FinancialReportingService],
})
export class FinancialReportingModule {}