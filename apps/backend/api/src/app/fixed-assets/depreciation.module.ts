import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FixedAsset } from './entities/fixed-asset.entity';
import { DepreciationService } from './depreciation.service';
import { DepreciationPort } from './depreciation.port';
import { AssetPostingService } from './asset-posting.service';
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
    TypeOrmModule.forFeature([FixedAsset]),
    forwardRef(() => JournalEntriesModule),
    forwardRef(() => AuthModule),
  ],
  providers: [
    AssetPostingService,
    DepreciationService,
    { provide: DepreciationPort, useExisting: DepreciationService },
  ],
  exports: [DepreciationPort, DepreciationService, AssetPostingService],
})
export class DepreciationModule {}
