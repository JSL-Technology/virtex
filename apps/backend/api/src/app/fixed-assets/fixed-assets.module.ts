
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FixedAssetsService } from './fixed-assets.service';
import { FixedAssetsController } from './fixed-assets.controller';
import { FixedAsset } from './entities/fixed-asset.entity';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { AuthModule } from '../auth/auth.module';
import { DepreciationService } from './depreciation.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Journal } from '../journal-entries/entities/journal.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FixedAsset,
      OrganizationSettings,
      Journal,
    ]),
    forwardRef(() => JournalEntriesModule),
    forwardRef(() => AuthModule),
  ],
  controllers: [FixedAssetsController],
  providers: [FixedAssetsService, DepreciationService],
  exports: [DepreciationService],
})
export class FixedAssetsModule {}