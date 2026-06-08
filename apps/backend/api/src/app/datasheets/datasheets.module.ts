
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatasheetBook } from './entities/datasheet-book.entity';
import { DatasheetSheet } from './entities/datasheet-sheet.entity';
import { DatasheetVersion } from './entities/datasheet-version.entity';
import { DatasheetPermission } from './entities/datasheet-permission.entity';
import { DatasheetsService } from './services/datasheets.service';
import { DatasheetsController } from './controllers/datasheets.controller';
import { DatasheetVariablesService } from './services/datasheet-variables.service';
import { DatasheetImportService } from './services/datasheet-import.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { CustomersModule } from '../customers/customers.module';
import { CacheModule } from '@nestjs/cache-manager';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Product } from '../inventory/entities/product.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { DashboardModule } from '../dashboard/dashboard.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DatasheetBook,
      DatasheetSheet,
      DatasheetVersion,
      DatasheetPermission,
      Invoice,
      Product,
      JournalEntryLine,
    ]),
    InvoicesModule,
    InventoryModule,
    OrganizationsModule,
    CustomersModule,
    DashboardModule,
    CacheModule.register(),
  ],
  controllers: [DatasheetsController],
  providers: [DatasheetsService, DatasheetVariablesService, DatasheetImportService],
  exports: [DatasheetsService, DatasheetVariablesService, DatasheetImportService],
})
export class DatasheetsModule {}
