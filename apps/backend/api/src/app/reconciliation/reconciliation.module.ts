
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { BankStatement } from './entities/bank-statement.entity';
import { BankTransaction } from './entities/bank-transaction.entity';
import { CsvParserService } from './parsers/csv-parser.service';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { AuthModule } from '../auth/auth.module';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { ReconciliationRule } from './entities/reconciliation-rule.entity';

import { JournalEntriesModule } from '../journal-entries/journal-entries.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BankStatement,
      BankTransaction,
      Account,
      JournalEntryLine,
      ReconciliationRule,
    ]),
    AuthModule,
    JournalEntriesModule,
  ],
  controllers: [ReconciliationController],
  providers: [ReconciliationService, CsvParserService],
})
export class ReconciliationModule {}