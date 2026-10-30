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
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { OrgSettingsModule } from '../organizations/org-settings.module';
import { ComplianceModule } from '../compliance/compliance.module';

/**
 * Point of sale, consolidated from special-enigma's POS domain. Reuses InventoryModule for
 * row-locked, tenant-scoped stock movement rather than reimplementing it.
 */
@Module({
  // The ledger and the fiscal ranges: a till sale posts its entries and draws its comprobante (QA R3-C02).
  imports: [TypeOrmModule.forFeature([PosShift, PosSale]), InventoryModule, AuthModule, JournalEntriesModule, OrgSettingsModule, ComplianceModule],
  controllers: [PosController],
  // The sales history's export (QA A-13).
  providers: [PosService, PosSalesDataTransferProvider, PosPostingService],
  exports: [PosService],
})
export class PosModule {}
