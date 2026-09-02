import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TreasuryService } from './treasury.service';
import { TreasuryController } from './treasury.controller';
import { BankTransfer } from './entities/bank-transfer.entity';
import { BankAccount } from './entities/bank-account.entity';
import { AccountingPeriod } from '../accounting/entities/accounting-period.entity';
import { AccountPeriodLock } from '../accounting/entities/account-period-lock.entity';
import { PeriodLockGuard } from '../accounting/guards/period-lock.guard';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BankTransfer,
      BankAccount,
      AccountingPeriod,
      AccountPeriodLock,
    ]),
    JournalEntriesModule,
    ChartOfAccountsModule,
    CurrenciesModule,
    AuthModule,
  ],
  controllers: [TreasuryController],
  providers: [TreasuryService, PeriodLockGuard],
  exports: [TreasuryService, TypeOrmModule],
})
export class TreasuryModule {}
