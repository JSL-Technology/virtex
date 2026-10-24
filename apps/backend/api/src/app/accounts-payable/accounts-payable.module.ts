import { BillMailHandler } from './inbox/bill-mail.handler';
import { AccountsPayableCopilotTools } from './accounts-payable.copilot-tools';
import { BillCaptureController } from './bill-capture.controller';
import { BillCaptureService } from './bill-capture.service';
import { VendorBillAttachment } from './entities/vendor-bill-attachment.entity';
// Bills read from a photo find their supplier by RNC, and ask the registry about an unknown one.
import { SuppliersModule } from '../suppliers/suppliers.module';
import { LocalizationProvisioningModule } from '../localization/localization-provisioning.module';

import { VendorBillsDataTransferProvider } from './vendor-bills-data-transfer.provider';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VendorPaymentsController } from './vendor-payments.controller';
import { SupplierStatementsController } from './supplier-statement.controller';
import { SupplierStatementService } from './supplier-statement.service';
import { VendorPaymentsService } from './vendor-payments.service';
import { AccountsPayableService } from './accounts-payable.service';
import { AccountsPayableController } from './accounts-payable.controller';
import { VendorBill } from './entities/vendor-bill.entity';
import { VendorBillLine } from './entities/vendor-bill-line.entity';
import { VendorPayment } from './entities/vendor-payment.entity';
import { VendorDebitNote } from './entities/vendor-debit-note.entity';
import { PaymentBatch } from './entities/payment-batch.entity';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ExchangeRate } from '../currencies/entities/exchange-rate.entity';
import { CurrenciesModule } from '../currencies/currencies.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { VendorDebitNotesController } from './vendor-debit-notes.controller';
import { VendorDebitNotesService } from './vendor-debit-notes.service';
import { PeriodLockModule } from '../accounting/period-lock.module';
import { AccountingModule } from '../accounting/accounting.module';
import { VendorBillApprovalHandler } from './vendor-bill-approval.handler';
import { VendorBillClosingBlockersProvider } from './vendor-bill-closing-blockers.provider';
import { PurchaseFiscalRecordsProvider } from './purchase-fiscal-records.provider';
// The ageing report ties itself to the payables control account in the general ledger.
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
// What is withheld from a supplier follows from who they are, resolved by the same service the
// sales side uses.
import { WithholdingModule } from '../localization/fiscal/withholding.module';
import { PayablesInboxProvider } from './inbox/payables-inbox.provider';
// Paying a supplier moves money: the payment routes demand step-up, whose guard lives in Auth.
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VendorBill,
      VendorBillLine,
      VendorBillAttachment,
      VendorPayment,
      VendorDebitNote,
      PaymentBatch,
      ExchangeRate,
      Supplier,
    ]),
    JournalEntriesModule,
    // InventoryModule removed — stock adjustments are now driven by 'vendor.bill.posted' and
    // 'vendor.bill.voided' events. VendorBillInventoryHandler in InventoryModule listens.
    WorkflowsModule,
    CurrenciesModule,
    BudgetsModule,
    ChartOfAccountsModule,
    WithholdingModule,
    PeriodLockModule,
    AccountingModule,
    AuthModule,
    SuppliersModule,
    LocalizationProvisioningModule,
  ],
  controllers: [BillCaptureController, AccountsPayableController, VendorDebitNotesController, VendorPaymentsController, SupplierStatementsController],
  providers: [AccountsPayableCopilotTools,
    BillCaptureService,
    PayablesInboxProvider,
    // Supplier bills received at the company's address (inbound-mail) become drafts or wait for review.
    BillMailHandler,
    VendorBillsDataTransferProvider,
    AccountsPayableService,
    VendorDebitNotesService,
    VendorPaymentsService,
    SupplierStatementService,
    // Posts the bill when its approval is granted, inside the approving transaction.
    VendorBillApprovalHandler,
    // Responde al checklist de cierre de Contabilidad sin que Contabilidad conozca esta tabla.
    VendorBillClosingBlockersProvider,
    // Answers the DGII purchases returns (606, 609) without Compliance knowing these tables.
    PurchaseFiscalRecordsProvider,
  ],
})
export class AccountsPayableModule {}