
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Warehouse } from './entities/warehouse.entity';
import { BinLocation } from './entities/bin-location.entity';
import { LandedCost } from './entities/landed-cost.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Warehouse,
      BinLocation,
      LandedCost
    ])
  ]
})
export class SupplyChainModule {}
