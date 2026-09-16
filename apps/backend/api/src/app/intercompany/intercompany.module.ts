import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { IntercompanyTransaction } from './entities/intercompany-transaction.entity';
import { IntercompanyService, INTERCOMPANY_QUEUE } from './intercompany.service';
import { IntercompanyProcessor } from './intercompany.processor';
import { IntercompanyController } from './intercompany.controller';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { AuthModule } from '../auth/auth.module';
import { AccountingModule } from '../accounting/accounting.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';

// Organization, OrganizationSettings, OrganizationGroupMember, Account, Journal, Ledger,
// AccountingPeriod, AccountPeriodLock are all read via DataSource.manager within the service.
// They are owned by their respective modules; declaring them in forFeature here would make
// IntercompanyModule look like their owner, which it is not.

/**
 * `intercompany-jobs` is registered here.
 *
 * It was not registered anywhere, and had no `@Processor` — so the destination half of every
 * intercompany movement was enqueued into nothing. See `IntercompanyProcessor`.
 */
@Module({
  imports: [
    // Only the entity this module owns.
    TypeOrmModule.forFeature([IntercompanyTransaction]),
    BullModule.registerQueue({ name: INTERCOMPANY_QUEUE }),
    JournalEntriesModule,
    // PeriodLockModule (via AccountingModule re-export) provides the period-lock guard and
    // LedgerLookupService for resolving the source ledger.
    AccountingModule,
    CurrenciesModule,
    ChartOfAccountsModule,
    AuthModule,
  ],
  providers: [IntercompanyService, IntercompanyProcessor],
  controllers: [IntercompanyController],
  exports: [IntercompanyService],
})
export class IntercompanyModule {}
