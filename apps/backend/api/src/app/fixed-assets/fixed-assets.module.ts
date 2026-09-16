import { Module } from '@nestjs/common';
import { FixedAssetsService } from './fixed-assets.service';
import { FixedAssetsController } from './fixed-assets.controller';
// DepreciationModule provides AssetPostingService, DepreciationService, and DepreciationPort.
// Importing it here lets FixedAssetsModule reuse those providers without re-declaring them.
import { DepreciationModule } from './depreciation.module';

@Module({
  imports: [DepreciationModule],
  controllers: [FixedAssetsController],
  providers: [FixedAssetsService],
  exports: [DepreciationModule, FixedAssetsService],
})
export class FixedAssetsModule {}