import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { CsvParserService } from './parsers/csv-parser.service';
import { BankStatement } from './entities/bank-statement.entity';
import { BankTransaction } from './entities/bank-transaction.entity';
import { ReconciliationMatch } from './entities/reconciliation-match.entity';
import { ReconciliationMatchLine } from './entities/reconciliation-match-line.entity';
import { ReconciliationRule } from './entities/reconciliation-rule.entity';
import { BankAccount } from '../treasury/entities/bank-account.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BankStatement,
      BankTransaction,
      ReconciliationMatch,
      ReconciliationMatchLine,
      ReconciliationRule,
      BankAccount,
      Account,
      JournalEntryLine,
    ]),
    AuthModule,
    JournalEntriesModule,
    ChartOfAccountsModule,
  ],
  controllers: [ReconciliationController],
  providers: [ReconciliationService, CsvParserService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
