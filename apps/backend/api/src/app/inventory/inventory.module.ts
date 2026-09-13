
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { Product } from './entities/product.entity';
import { ProductCategory } from './entities/product-category.entity';
import { ProductCategoriesController } from './product-categories.controller';
import { ProductCategoriesService } from './product-categories.service';
import { AuthModule } from '../auth/auth.module';
import { InventoryPostingService } from './inventory-posting.service';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';

@Module({
  imports: [TypeOrmModule.forFeature([Product, ProductCategory]), AuthModule, JournalEntriesModule],
  controllers: [InventoryController, ProductCategoriesController],
  providers: [InventoryService, InventoryPostingService, ProductCategoriesService],
  exports: [InventoryService, ProductCategoriesService],
})
export class InventoryModule {}
