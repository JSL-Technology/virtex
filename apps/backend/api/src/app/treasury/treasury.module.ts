import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TreasuryService } from './treasury.service';
import { TreasuryController } from './treasury.controller';
import { BankTransfer } from './entities/bank-transfer.entity';
import { BankAccount } from './entities/bank-account.entity';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { AuthModule } from '../auth/auth.module';
import { PeriodLockModule } from '../accounting/period-lock.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BankTransfer, BankAccount]),
    JournalEntriesModule,
    ChartOfAccountsModule,
    CurrenciesModule,
    AuthModule,
    PeriodLockModule,
    AccountingModule,
  ],
  controllers: [TreasuryController],
  providers: [TreasuryService],
  exports: [TreasuryService],
})
export class TreasuryModule {}
