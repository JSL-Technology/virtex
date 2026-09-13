import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseRequisition } from './entities/purchase-requisition.entity';
import { PurchaseRequisitionLine } from './entities/purchase-requisition-line.entity';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { SupplierPortalUser } from './entities/supplier-portal-user.entity';
import { ProcurementService } from './procurement.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { ProcurementController } from './procurement.controller';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { AuthModule } from '../auth/auth.module';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PurchaseRequisition,
      PurchaseRequisitionLine,
      PurchaseOrder,
      PurchaseOrderLine,
      SupplierPortalUser,
    ]),
    AuthModule,
    // For the document numbering service only: purchasing posts nothing to the ledger.
    JournalEntriesModule,
  ],
  controllers: [ProcurementController, PurchaseOrdersController],
  providers: [ProcurementService, PurchaseOrdersService],
  exports: [ProcurementService, PurchaseOrdersService],
})
export class ProcurementModule {}
