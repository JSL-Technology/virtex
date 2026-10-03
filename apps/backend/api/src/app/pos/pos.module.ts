import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PosShift } from './entities/pos-shift.entity';
import { PosSale } from './entities/pos-sale.entity';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { InventoryModule } from '../inventory/inventory.module';
import { AuthModule } from '../auth/auth.module';
import { PosSalesDataTransferProvider } from './pos-data-transfer.provider';

/**
 * Point of sale, consolidated from special-enigma's POS domain. Reuses InventoryModule for
 * row-locked, tenant-scoped stock movement rather than reimplementing it.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PosShift, PosSale]), InventoryModule, AuthModule],
  controllers: [PosController],
  // The sales history's export (QA A-13).
  providers: [PosService, PosSalesDataTransferProvider],
  exports: [PosService],
})
export class PosModule {}
