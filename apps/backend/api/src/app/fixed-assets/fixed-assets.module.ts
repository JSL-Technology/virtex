
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FixedAssetsService } from './fixed-assets.service';
import { FixedAssetsController } from './fixed-assets.controller';
import { FixedAsset } from './entities/fixed-asset.entity';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { AuthModule } from '../auth/auth.module';
import { DepreciationService } from './depreciation.service';
import { AssetPostingService } from './asset-posting.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FixedAsset]),
    forwardRef(() => JournalEntriesModule),
    forwardRef(() => AuthModule),
  ],
  controllers: [FixedAssetsController],
  providers: [FixedAssetsService, DepreciationService, AssetPostingService],
  exports: [DepreciationService, AssetPostingService],
})
export class FixedAssetsModule {}