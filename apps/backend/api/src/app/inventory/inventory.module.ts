
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { Product } from './entities/product.entity';
import { AuthModule } from '../auth/auth.module';
import { InventoryPostingService } from './inventory-posting.service';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';

@Module({
  imports: [TypeOrmModule.forFeature([Product]), AuthModule, JournalEntriesModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryPostingService],
  exports: [InventoryService],
})
export class InventoryModule {}
