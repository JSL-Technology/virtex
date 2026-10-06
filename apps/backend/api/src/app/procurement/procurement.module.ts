import { PurchaseOrderApprovalSource, RequisitionApprovalSource } from './procurement-approval.sources';
import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseRequisition } from './entities/purchase-requisition.entity';
import { PurchaseRequisitionLine } from './entities/purchase-requisition-line.entity';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { SupplierPortalUser } from './entities/supplier-portal-user.entity';
import { PurchaseOrderReceipt } from './entities/purchase-order-receipt.entity';
import { InventoryModule } from '../inventory/inventory.module';
import { ProcurementService } from './procurement.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { ProcurementController } from './procurement.controller';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { AuthModule } from '../auth/auth.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { LifecycleRegistry } from '../shared/lifecycle/lifecycle.registry';
import { PURCHASE_ORDER_LIFECYCLE, REQUISITION_LIFECYCLE } from './procurement-lifecycles';

import { GoodsReceiptsController } from './goods-receipts.controller';
import { GoodsReceiptsService } from './goods-receipts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PurchaseRequisition,
      PurchaseRequisitionLine,
      PurchaseOrder,
      PurchaseOrderLine,
      SupplierPortalUser,
      PurchaseOrderReceipt,
    ]),
    // A receipt brings goods into stock (and onto the books) through the inventory module.
    InventoryModule,
    AuthModule,
    // For the document numbering service only: purchasing posts nothing to the ledger.
    JournalEntriesModule,
    // A foreign-currency order is costed at the spot rate of the day its goods arrive (QA A-12).
    CurrenciesModule,
  ],
  controllers: [ProcurementController, PurchaseOrdersController, GoodsReceiptsController],
  providers: [ProcurementService, PurchaseOrdersService, GoodsReceiptsService, PurchaseOrderApprovalSource, RequisitionApprovalSource],
  exports: [ProcurementService, PurchaseOrdersService],
})
export class ProcurementModule implements OnModuleInit {
  constructor(private readonly lifecycles: LifecycleRegistry) {}

  /**
   * Compras apunta la vida de sus dos documentos. Se apunta solo, igual que la bandeja: el
   * registro no lleva una lista que alguien tenga que acordarse de ampliar al añadir un módulo.
   */
  onModuleInit(): void {
    this.lifecycles.register(REQUISITION_LIFECYCLE);
    this.lifecycles.register(PURCHASE_ORDER_LIFECYCLE);
  }
}
