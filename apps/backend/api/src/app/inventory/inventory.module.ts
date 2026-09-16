
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { Product } from './entities/product.entity';
import { ProductCategory } from './entities/product-category.entity';
import { Location } from '../supply-chain/entities/location.entity';
import { StockItem } from '../supply-chain/entities/stock-item.entity';
import { StockMovement } from '../supply-chain/entities/stock-movement.entity';
import { ProductCategoriesController } from './product-categories.controller';
import { ProductCategoriesService } from './product-categories.service';
import { AuthModule } from '../auth/auth.module';
import { InventoryPostingService } from './inventory-posting.service';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { VendorBillInventoryHandler } from './handlers/vendor-bill-inventory.handler';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product, ProductCategory, Location, StockItem, StockMovement]),
    AuthModule,
    JournalEntriesModule,
  ],
  controllers: [InventoryController, ProductCategoriesController],
  providers: [InventoryService, InventoryPostingService, ProductCategoriesService, VendorBillInventoryHandler],
  exports: [InventoryService, ProductCategoriesService],
})
export class InventoryModule {}
