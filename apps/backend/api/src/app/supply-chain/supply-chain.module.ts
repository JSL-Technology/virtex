import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Warehouse } from './entities/warehouse.entity';
import { BinLocation } from './entities/bin-location.entity';
import { LandedCost } from './entities/landed-cost.entity';
import { Location } from './entities/location.entity';
import { StockItem } from './entities/stock-item.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { SupplyChainService } from './supply-chain.service';
import { SupplyChainController } from './supply-chain.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Warehouse, BinLocation, LandedCost, Location, StockItem, StockMovement]),
    AuthModule,
  ],
  controllers: [SupplyChainController],
  providers: [SupplyChainService],
  exports: [SupplyChainService],
})
export class SupplyChainModule {}
