
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseRequisition } from './entities/purchase-requisition.entity';
import { SupplierPortalUser } from './entities/supplier-portal-user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PurchaseRequisition,
      SupplierPortalUser
    ])
  ]
})
export class ProcurementModule {}
