import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Warehouse } from './entities/warehouse.entity';
import { BinLocation } from './entities/bin-location.entity';
import { LandedCost } from './entities/landed-cost.entity';
import { SupplyChainService } from './supply-chain.service';
import { SupplyChainController } from './supply-chain.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Warehouse, BinLocation, LandedCost]),
    AuthModule,
  ],
  controllers: [SupplyChainController],
  providers: [SupplyChainService],
  exports: [SupplyChainService],
})
export class SupplyChainModule {}
