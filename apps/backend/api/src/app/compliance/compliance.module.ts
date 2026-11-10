
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceService } from './compliance.service';
import { ComplianceController } from './compliance.controller';
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
    // The 606 and 609 read purchases through `PurchaseFiscalRecordsRegistry` (ContractsModule,
    // global), not by registering Purchasing's entities here.
    TypeOrmModule.forFeature([
      Invoice,
      Organization,
      FiscalReportFiling,
    ]),
    AuthModule,
    // Mexico's electronic accounting reads the ledger through the same service the balance sheet
    // does, so the filing and the statements cannot disagree.
    ChartOfAccountsModule,
  ],

  controllers: [ComplianceController],
  providers: [ComplianceService, FiscalReportFilingsService],
  exports: [ComplianceService],
})
export class ComplianceModule {}