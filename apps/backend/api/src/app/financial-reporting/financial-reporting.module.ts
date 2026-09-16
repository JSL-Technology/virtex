
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinancialReportingController } from './financial-reporting.controller';
import { FinancialReportingService } from './financial-reporting.service';

import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
import { AuditModule } from '../audit/audit.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [
    // Reading and exporting financial data is recorded; the interceptor lives in AuditModule.
    AuditModule,
    // Account queries go through AccountBalancesService and DataSource, not through a declared
    // repository ownership — FinancialReporting reads, never writes, ChartOfAccounts tables.
    ChartOfAccountsModule,
    AccountingModule,
  ],
  controllers: [FinancialReportingController],
  providers: [FinancialReportingService],

  exports: [FinancialReportingService],
})
export class FinancialReportingModule {}