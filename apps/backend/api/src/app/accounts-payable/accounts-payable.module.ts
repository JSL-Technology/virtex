
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsPayableService } from './accounts-payable.service';
import { AccountsPayableController } from './accounts-payable.controller';
import { VendorBill } from './entities/vendor-bill.entity';
import { VendorBillLine } from './entities/vendor-bill-line.entity';
import { VendorPayment } from './entities/vendor-payment.entity';
import { VendorDebitNote } from './entities/vendor-debit-note.entity';
import { PaymentBatch } from './entities/payment-batch.entity';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { InventoryModule } from '../inventory/inventory.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ExchangeRate } from '../currencies/entities/exchange-rate.entity';
import { CurrenciesModule } from '../currencies/currencies.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { VendorDebitNotesController } from './vendor-debit-notes.controller';
import { VendorDebitNotesService } from './vendor-debit-notes.service';
import { PeriodLockModule } from '../accounting/period-lock.module';
import { AccountingModule } from '../accounting/accounting.module';
import { VendorBillApprovalHandler } from './vendor-bill-approval.handler';
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
      ExchangeRate,
      Supplier,
    ]),
    JournalEntriesModule,
    InventoryModule,
    WorkflowsModule,
    CurrenciesModule,
    BudgetsModule,
    ChartOfAccountsModule,
    WithholdingModule,
    PeriodLockModule,
    AccountingModule,
  ],
  controllers: [AccountsPayableController, VendorDebitNotesController],
  providers: [
    AccountsPayableService,
    VendorDebitNotesService,
    // Posts the bill when its approval is granted, inside the approving transaction.
    VendorBillApprovalHandler,
  ],
})
export class AccountsPayableModule {}