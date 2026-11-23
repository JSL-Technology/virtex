import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FixedAsset } from './entities/fixed-asset.entity';
import { FixedAssetDepreciation } from './entities/fixed-asset-depreciation.entity';
import { FixedAssetDepreciationRun } from './entities/fixed-asset-depreciation-run.entity';
import { FixedAssetCategory } from './entities/fixed-asset-category.entity';
import { FixedAssetBook } from './entities/fixed-asset-book.entity';
import { FixedAssetBookCharge } from './entities/fixed-asset-book-charge.entity';
import { DepreciationService } from './depreciation.service';
import { DepreciationPort } from './depreciation.port';
import { AssetPostingService } from './asset-posting.service';
import { TaxBookService } from './tax-book.service';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Leaf module that exposes only the `DepreciationPort`.
 *
 * ## Why this exists
 *
 * `AccountingModule` needs to trigger depreciation during period closing
 * (`ClosingAutomationService`), but importing the full `FixedAssetsModule` created a three-way
 * cycle: Accounting → FixedAssets → JournalEntries → PeriodLockModule → (part of Accounting).
 *
 * This module is the same leaf pattern as `PeriodLockModule`: a minimal, dependency-free
 * surface that the consumer depends on instead of the full feature module. `FixedAssetsModule`
 * imports this module and re-exports the port so internal code keeps working.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      FixedAsset,
      FixedAssetDepreciation,
      FixedAssetDepreciationRun,
      FixedAssetCategory,
      FixedAssetBook,
      FixedAssetBookCharge,
    ]),
    forwardRef(() => JournalEntriesModule),
    forwardRef(() => AuthModule),
  ],
  providers: [
    AssetPostingService,
    TaxBookService,
    DepreciationService,
    { provide: DepreciationPort, useExisting: DepreciationService },
  ],
  exports: [DepreciationPort, DepreciationService, AssetPostingService, TaxBookService],
})
export class DepreciationModule {}
