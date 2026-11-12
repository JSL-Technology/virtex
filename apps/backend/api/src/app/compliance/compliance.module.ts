
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceController } from './compliance.controller';
import { ReturnsService } from './returns/returns.service';
import { ReturnDatasetFactory } from './returns/return-dataset';
import { FiscalReportFiling } from './entities/fiscal-report-filing.entity';
import { FiscalReportFilingsService } from './fiscal-report-filings.service';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';


@Module({

  imports: [
    // Reading and exporting financial data is recorded; the interceptor lives in AuditModule.
    AuditModule,
    // A purchases return reads purchases through `PurchaseFiscalRecordsRegistry` (ContractsModule,
    // global), not by registering Purchasing's entities here.
    TypeOrmModule.forFeature([
      Invoice,
      Organization,
      FiscalReportFiling,
    ]),
    AuthModule,
    // A bookkeeping filing reads the ledger through the same service the balance sheet does, so
    // the file and the statements cannot disagree.
    ChartOfAccountsModule,
  ],

  controllers: [ComplianceController],
  providers: [ReturnsService, ReturnDatasetFactory, FiscalReportFilingsService],
  // The engine that builds any market's return, for a caller that needs one outside HTTP.
  exports: [ReturnsService],
})
export class ComplianceModule {}