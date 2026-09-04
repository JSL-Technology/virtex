
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BudgetsService } from './budgets.service';
import { BudgetsController } from './budgets.controller';
import { Budget } from './entities/budget.entity';
import { BudgetLine } from './entities/budget-line.entity';
import { BudgetControlService } from './budget-control.service';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Budget,
      BudgetLine,
      JournalEntryLine,
      // The budget is compared against one book's valuations, not against `line.debit`.
      Ledger,
    ]),
    AuthModule,
  ],
  controllers: [BudgetsController],
  providers: [BudgetsService, BudgetControlService],
  exports: [BudgetControlService],
})
export class BudgetsModule {}