
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsPayableService } from './accounts-payable.service';
import { AccountsPayableController } from './accounts-payable.controller';
import { VendorBill } from './entities/vendor-bill.entity';
import { VendorBillLine } from './entities/vendor-bill-line.entity';
import { VendorPayment } from './entities/vendor-payment.entity';
import { VendorDebitNote } from './entities/vendor-debit-note.entity';
import { PaymentBatch } from './entities/payment-batch.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { InventoryModule } from '../inventory/inventory.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ExchangeRate } from '../currencies/entities/exchange-rate.entity';
import { CurrenciesModule } from '../currencies/currencies.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { VendorDebitNotesController } from './vendor-debit-notes.controller';
import { VendorDebitNotesService } from './vendor-debit-notes.service';
import { AccountingPeriod } from '../accounting/entities/accounting-period.entity';
import { AccountPeriodLock } from '../accounting/entities/account-period-lock.entity';
import { PeriodLockGuard } from '../accounting/guards/period-lock.guard';
import { VendorBillApprovalHandler } from './vendor-bill-approval.handler';
import { VendorBillClosingBlockersProvider } from './vendor-bill-closing-blockers.provider';
// The ageing report ties itself to the payables control account in the general ledger.
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
// What is withheld from a supplier follows from who they are, resolved by the same service the
// sales side uses.
import { WithholdingModule } from '../localization/fiscal/withholding.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VendorBill,
      VendorBillLine,
      VendorPayment,
      VendorDebitNote,
      PaymentBatch,
      OrganizationSettings,
      ExchangeRate,
      AccountingPeriod,
      AccountPeriodLock,
      Supplier,
    ]),
    JournalEntriesModule,
    InventoryModule,
    WorkflowsModule,
    CurrenciesModule,
    BudgetsModule,
    ChartOfAccountsModule,
    WithholdingModule,
  ],
  controllers: [AccountsPayableController, VendorDebitNotesController],
  providers: [
    AccountsPayableService,
    VendorDebitNotesService,
    PeriodLockGuard,
    // Posts the bill when its approval is granted, inside the approving transaction.
    VendorBillApprovalHandler,
    // Responde al checklist de cierre de Contabilidad sin que Contabilidad conozca esta tabla.
    VendorBillClosingBlockersProvider,
  ],
})
export class AccountsPayableModule {}