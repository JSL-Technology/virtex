import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FixedAsset } from './entities/fixed-asset.entity';
import { FixedAssetsService } from './fixed-assets.service';
import { FixedAssetsController } from './fixed-assets.controller';
// DepreciationModule provides AssetPostingService, DepreciationService, and DepreciationPort.
// Importing it here lets FixedAssetsModule reuse those providers without re-declaring them.
import { DepreciationModule } from './depreciation.module';

@Module({
  imports: [
    // `FixedAssetsService` injects `Repository<FixedAsset>` and this module never registered it.
    // `DepreciationModule` does `forFeature([FixedAsset])` for its own use but does not re-export
    // TypeOrmModule, so importing it brought the services and not the repository — and Nest could
    // not resolve `FixedAssetsService` at all, which stopped the application booting.
    TypeOrmModule.forFeature([FixedAsset]),
    DepreciationModule,
  ],
  controllers: [FixedAssetsController],
  providers: [FixedAssetsService],
  exports: [DepreciationModule, FixedAssetsService],
})
export class FixedAssetsModule {}