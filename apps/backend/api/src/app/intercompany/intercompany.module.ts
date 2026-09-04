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
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { OrganizationGroupMember } from '../organizations/entities/organization-group-member.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { AccountingPeriod } from '../accounting/entities/accounting-period.entity';
import { AccountPeriodLock } from '../accounting/entities/account-period-lock.entity';

/**
 * `intercompany-jobs` is registered here.
 *
 * It was not registered anywhere, and had no `@Processor` — so the destination half of every
 * intercompany movement was enqueued into nothing. See `IntercompanyProcessor`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      IntercompanyTransaction,
      Organization,
      OrganizationSettings,
      OrganizationGroupMember,
      Account,
      Journal,
      Ledger,
      AccountingPeriod,
      AccountPeriodLock,
    ]),
    BullModule.registerQueue({ name: INTERCOMPANY_QUEUE }),
    JournalEntriesModule,
    AccountingModule,
    CurrenciesModule,
    AuthModule,
  ],
  providers: [IntercompanyService, IntercompanyProcessor],
  controllers: [IntercompanyController],
  exports: [IntercompanyService],
})
export class IntercompanyModule {}
