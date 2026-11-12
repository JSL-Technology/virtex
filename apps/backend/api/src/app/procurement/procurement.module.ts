import { PurchaseReturn } from './entities/purchase-return.entity';
import { LandedCostAllocation } from './entities/landed-cost-allocation.entity';
import { LandedCostsService } from './landed-costs.service';
import { LandedCostsController } from './landed-costs.controller';
import { PurchaseRfq, PurchaseRfqLine, PurchaseRfqSupplier } from './entities/purchase-rfq.entity';
import { SupplierQuote, SupplierQuoteLine } from './entities/supplier-quote.entity';
import { PurchaseAgreement, PurchaseAgreementLine } from './entities/purchase-agreement.entity';
import { RfqsService } from './rfqs.service';
import { RfqsController } from './rfqs.controller';
import { PurchaseAgreementsService } from './purchase-agreements.service';
import { PurchaseAgreementsController } from './purchase-agreements.controller';
import { ProcurementCopilotTools } from './procurement.copilot-tools';
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
import { ReplenishmentAgentSettings } from './replenishment/replenishment-settings.entity';
import { ReplenishmentAgentService } from './replenishment/replenishment-agent.service';
import { ReplenishmentAgentController } from './replenishment/replenishment-agent.controller';
import { ReplenishmentWorkflowActions } from './replenishment/replenishment.workflow-actions';
import { WorkflowEngineModule } from '../workflow-engine/workflow-engine.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PurchaseRequisition,
      PurchaseRequisitionLine,
      PurchaseOrder,
      PurchaseOrderLine,
      SupplierPortalUser,
      PurchaseOrderReceipt,
      LandedCostAllocation,
      PurchaseReturn,
      PurchaseRfq,
      PurchaseRfqLine,
      PurchaseRfqSupplier,
      SupplierQuote,
      SupplierQuoteLine,
      PurchaseAgreement,
      PurchaseAgreementLine,
      ReplenishmentAgentSettings,
    ]),
    // The replenishment agent registers a workflow step.
    WorkflowEngineModule,
    // A receipt brings goods into stock (and onto the books) through the inventory module.
    InventoryModule,
    AuthModule,
    // Document numbering, and the landed-cost entry (CMP-21) through the posting port.
    JournalEntriesModule,
    // A foreign-currency order is costed at the spot rate of the day its goods arrive (QA A-12).
    CurrenciesModule,
  ],
  controllers: [RfqsController, PurchaseAgreementsController, LandedCostsController, ProcurementController, PurchaseOrdersController, GoodsReceiptsController, ReplenishmentAgentController],
  providers: [RfqsService, PurchaseAgreementsService, LandedCostsService, ProcurementCopilotTools, ProcurementService, PurchaseOrdersService, GoodsReceiptsService, PurchaseOrderApprovalSource, RequisitionApprovalSource, ReplenishmentAgentService, ReplenishmentWorkflowActions],
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
