import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ProfitabilityService } from './profitability.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { AccountingModule } from '../accounting/accounting.module';
import { AuthModule } from '../auth/auth.module';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceLineItem } from '../invoices/entities/invoice-line-item.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { JournalEntry } from '../journal-entries/entities/journal-entry.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Report } from './entities/report.entity';

/**
 * `AuthModule` is imported because these routes now declare permissions.
 *
 * They declared none: `ReportsController` served the complete general ledger and the complete
 * daybook to any authenticated member of the tenant — a warehouse clerk, an HR user, anyone with a
 * token. `permissions-enforced.spec.ts` did not catch it because it checks that a *declared*
 * permission is enforced, not that one is declared.
 */
@Module({
  imports: [
    InvoicesModule,
    AccountingModule,
    AuthModule,
    TypeOrmModule.forFeature([
      Invoice,
      InvoiceLineItem,
      JournalEntryLine,
      JournalEntry,
      Account,
      Ledger,
      Report,
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService, ProfitabilityService],
})
export class ReportsModule {}
