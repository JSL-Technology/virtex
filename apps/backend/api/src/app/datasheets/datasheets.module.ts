import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { DatasheetBook } from './entities/datasheet-book.entity';
import { DatasheetSheet } from './entities/datasheet-sheet.entity';
import { DatasheetVersion } from './entities/datasheet-version.entity';
import { DatasheetPermission } from './entities/datasheet-permission.entity';
import { DatasheetsService } from './services/datasheets.service';
import { DatasheetsController } from './controllers/datasheets.controller';
import { DatasheetVariablesService } from './services/datasheet-variables.service';
import { DatasheetImportService } from './services/datasheet-import.service';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceLineItem } from '../invoices/entities/invoice-line-item.entity';
import { Product } from '../inventory/entities/product.entity';
import { Customer } from '../customers/entities/customer.entity';
import { VendorBill } from '../accounts-payable/entities/vendor-bill.entity';
import { Employee } from '../hcm/entities/employee.entity';
import { Budget } from '../budgets/entities/budget.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { FinancialReportingModule } from '../financial-reporting/financial-reporting.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { SharedModule } from '../shared/shared.module';

/**
 * The variables and datasets a spreadsheet may read.
 *
 * The repositories are registered here rather than reached through other modules' services because
 * every read is a plain, tenant-scoped aggregate over one table — and because the figures that
 * genuinely belong to another module (the income statement, the cash position, an exchange rate)
 * come from that module's own service, so a spreadsheet and a report cannot disagree.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DatasheetBook,
      DatasheetSheet,
      DatasheetVersion,
      DatasheetPermission,
      Invoice,
      InvoiceLineItem,
      Product,
      Customer,
      VendorBill,
      Employee,
      Budget,
      Account,
      Organization,
      OrganizationSettings,
    ]),
    forwardRef(() => FinancialReportingModule),
    forwardRef(() => TreasuryModule),
    forwardRef(() => CurrenciesModule),
    SharedModule,
    CacheModule.register(),
  ],
  controllers: [DatasheetsController],
  providers: [DatasheetsService, DatasheetVariablesService, DatasheetImportService],
  exports: [DatasheetsService, DatasheetVariablesService, DatasheetImportService],
})
export class DatasheetsModule {}
