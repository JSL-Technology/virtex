import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [InvoicesModule, InventoryModule, CustomersModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}