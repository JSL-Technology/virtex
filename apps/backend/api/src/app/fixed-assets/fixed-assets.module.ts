import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FixedAsset } from './entities/fixed-asset.entity';
import { FixedAssetsService } from './fixed-assets.service';
import { FixedAssetsController } from './fixed-assets.controller';
// DepreciationModule provides AssetPostingService, DepreciationService, and DepreciationPort.
// Importing it here lets FixedAssetsModule reuse those providers without re-declaring them.
import { DepreciationModule } from './depreciation.module';
// JournalEntriesModule exports JournalLookupService and LedgerNarrativeService, both injected by
// FixedAssetsService. DepreciationModule imports JournalEntriesModule via forwardRef but does not
// re-export it, so those two providers were invisible here and Nest could not resolve
// FixedAssetsService (`can't resolve ... JournalLookupService at index [3]`). Importing it
// directly does not reintroduce the Accounting → FixedAssets → JournalEntries cycle: Accounting
// depends on the DepreciationModule leaf, not on FixedAssetsModule.
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';

@Module({
  imports: [
    // `FixedAssetsService` injects `Repository<FixedAsset>` and this module never registered it.
    // `DepreciationModule` does `forFeature([FixedAsset])` for its own use but does not re-export
    // TypeOrmModule, so importing it brought the services and not the repository — and Nest could
    // not resolve `FixedAssetsService` at all, which stopped the application booting.
    TypeOrmModule.forFeature([FixedAsset]),
    DepreciationModule,
    forwardRef(() => JournalEntriesModule),
  ],
  controllers: [FixedAssetsController],
  providers: [FixedAssetsService],
  exports: [DepreciationModule, FixedAssetsService],
})
export class FixedAssetsModule {}