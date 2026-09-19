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
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
import { AuthModule } from '../auth/auth.module';
import { ReconciliationClosingBlockersProvider } from './reconciliation-closing-blockers.provider';

@Module({
  imports: [
    // Only the entities this module owns.
    TypeOrmModule.forFeature([
      BankStatement,
      BankTransaction,
      ReconciliationMatch,
      ReconciliationMatchLine,
      ReconciliationRule,
    ]),
    AuthModule,
    // Account (chart-of-accounts) and BankAccount (treasury) are accessed via DataSource.
    ChartOfAccountsModule,
    // JournalEntryLine/JournalEntryLineValuation reads go through JournalQueryService.
    JournalEntriesModule,
  ],
  controllers: [ReconciliationController],
  providers: [
    ReconciliationService,
    CsvParserService,
    // Responde al checklist de cierre de Contabilidad sin que Contabilidad conozca esta tabla.
    ReconciliationClosingBlockersProvider,
  ],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
