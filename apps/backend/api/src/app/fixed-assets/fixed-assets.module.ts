import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FixedAsset } from './entities/fixed-asset.entity';
import { FixedAssetDepreciation } from './entities/fixed-asset-depreciation.entity';
import { FixedAssetDepreciationRun } from './entities/fixed-asset-depreciation-run.entity';
import { FixedAssetCategory } from './entities/fixed-asset-category.entity';
import { FixedAssetBook } from './entities/fixed-asset-book.entity';
import { FixedAssetBookCharge } from './entities/fixed-asset-book-charge.entity';
import { FixedAssetsService } from './fixed-assets.service';
import { FixedAssetsController } from './fixed-assets.controller';
import { FixedAssetCategoriesService } from './fixed-asset-categories.service';
import { FixedAssetCategoriesController } from './fixed-asset-categories.controller';
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
    TypeOrmModule.forFeature([
      FixedAsset,
      FixedAssetDepreciation,
      FixedAssetDepreciationRun,
      FixedAssetCategory,
      FixedAssetBook,
      FixedAssetBookCharge,
    ]),
    DepreciationModule,
    forwardRef(() => JournalEntriesModule),
  ],
  // The categories first: `fixed-assets/categories` is a path of its own, never an asset id.
  controllers: [FixedAssetCategoriesController, FixedAssetsController],
  providers: [FixedAssetsService, FixedAssetCategoriesService],
  exports: [DepreciationModule, FixedAssetsService],
})
export class FixedAssetsModule {}