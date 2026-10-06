
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryService } from './inventory.service';
import { ProductsDataTransferProvider } from './products-data-transfer.provider';
import { InventoryController } from './inventory.controller';
import { StockController } from './stock.controller';
import { StockQueriesService } from './stock-queries.service';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import { StockTransfersService } from './stock-transfers.service';
import { InventoryAdjustment, InventoryAdjustmentLine } from './entities/inventory-adjustment.entity';
import { StockTransfer, StockTransferLine } from './entities/stock-transfer.entity';
import { Warehouse } from '../supply-chain/entities/warehouse.entity';
import { Product } from './entities/product.entity';
import { ProductCategory } from './entities/product-category.entity';
import { Location } from '../supply-chain/entities/location.entity';
import { StockLevel } from '../supply-chain/entities/stock-level.entity';
import { StockMovement } from '../supply-chain/entities/stock-movement.entity';
import { ProductCategoriesController } from './product-categories.controller';
import { ProductCategoriesService } from './product-categories.service';
import { AuthModule } from '../auth/auth.module';
import { InventoryPostingService } from './inventory-posting.service';
import { StockLedgerService } from './stock-ledger.service';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { VendorBillInventoryHandler } from './handlers/vendor-bill-inventory.handler';
import { GoodsReceiptPort } from './contracts/goods-receipt.contract';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Product,
      ProductCategory,
      Location,
      StockLevel,
      StockMovement,
      Warehouse,
      InventoryAdjustment,
      InventoryAdjustmentLine,
      StockTransfer,
      StockTransferLine,
    ]),
    AuthModule,
    JournalEntriesModule,
  ],
  // The stock controller first: its literal paths must win over the catalogue's `inventory/:id`.
  controllers: [StockController, InventoryController, ProductCategoriesController],
  providers: [
    InventoryService,
    ProductsDataTransferProvider,
    InventoryPostingService,
    StockLedgerService,
    StockQueriesService,
    InventoryAdjustmentsService,
    StockTransfersService,
    ProductCategoriesService,
    VendorBillInventoryHandler,
    // Purchasing brings goods into stock through the port, not through the service.
    { provide: GoodsReceiptPort, useExisting: InventoryService },
  ],
  exports: [InventoryService, ProductCategoriesService, GoodsReceiptPort, StockLedgerService],
})
export class InventoryModule {}
