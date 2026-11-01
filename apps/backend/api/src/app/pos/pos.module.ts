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
import { ComplianceModule } from '../compliance/compliance.module';

/**
 * Point of sale, consolidated from special-enigma's POS domain. Reuses InventoryModule for
 * row-locked, tenant-scoped stock movement rather than reimplementing it.
 */
@Module({
  // The fiscal ranges: a till sale draws its comprobante (QA R3-C02). It posts through the global
  // ledger-posting contract, so accounting is not imported here.
  imports: [TypeOrmModule.forFeature([PosShift, PosSale]), InventoryModule, AuthModule, ComplianceModule],
  controllers: [PosController],
  // The sales history's export (QA A-13).
  providers: [PosService, PosSalesDataTransferProvider, PosPostingService],
  exports: [PosService],
})
export class PosModule {}
