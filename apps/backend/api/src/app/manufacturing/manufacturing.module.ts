
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ManufacturingService } from './manufacturing.service';
import { ManufacturingController } from './manufacturing.controller';
import { ProductionOrder } from './entities/production-order.entity';
import { BillOfMaterial } from './entities/bill-of-material.entity';
import { BillOfMaterialItem } from './entities/bill-of-material-item.entity';
import { WorkCenter } from './entities/work-center.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductionOrder,
      BillOfMaterial,
      BillOfMaterialItem,
      WorkCenter
    ])
  ],
  controllers: [ManufacturingController],
  providers: [ManufacturingService],
  exports: [ManufacturingService]
})
export class ManufacturingModule {}
