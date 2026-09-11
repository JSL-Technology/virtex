import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseRequisition } from './entities/purchase-requisition.entity';
import { SupplierPortalUser } from './entities/supplier-portal-user.entity';
import { ProcurementService } from './procurement.service';
import { ProcurementController } from './procurement.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PurchaseRequisition, SupplierPortalUser]),
    AuthModule,
  ],
  controllers: [ProcurementController],
  providers: [ProcurementService],
  exports: [ProcurementService],
})
export class ProcurementModule {}
