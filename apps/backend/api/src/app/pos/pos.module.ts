import { PriceListsModule } from '../price-lists/price-lists.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PosShift } from './entities/pos-shift.entity';
import { PosSale } from './entities/pos-sale.entity';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { InventoryModule } from '../inventory/inventory.module';
import { AuthModule } from '../auth/auth.module';
import { PosSalesDataTransferProvider } from './pos-data-transfer.provider';
import { PosPostingService } from './pos-posting.service';
import { FiscalNumberingModule } from '../invoices/adapters/fiscal-numbering.module';
import { PosIssuedFiscalNumbers } from './issued-fiscal-numbers.source';

/**
 * Point of sale, consolidated from special-enigma's POS domain. Reuses InventoryModule for
 * row-locked, tenant-scoped stock movement rather than reimplementing it.
 */
@Module({
  // The numbering engine: a till sale draws the receipt its market hands consumers (QA R3-C02). It
  // posts through the global ledger-posting contract, so accounting is not imported here.
  imports: [TypeOrmModule.forFeature([PosShift, PosSale]), InventoryModule, AuthModule, FiscalNumberingModule, PriceListsModule],
  controllers: [PosController],
  // The sales history's export (QA A-13).
  // The receipts already drawn, for the ranges registered after them.
  providers: [PosService, PosSalesDataTransferProvider, PosPostingService, PosIssuedFiscalNumbers],
  exports: [PosService],
})
export class PosModule {}
