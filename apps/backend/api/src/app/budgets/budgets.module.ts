
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BudgetsService } from './budgets.service';
import { BudgetsController } from './budgets.controller';
import { Budget } from './entities/budget.entity';
import { BudgetLine } from './entities/budget-line.entity';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { BudgetControlService } from './budget-control.service';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Budget, 
      BudgetLine, 
      JournalEntryLine
    ]),
    JournalEntriesModule,
    AuthModule,
  ],
  controllers: [BudgetsController],
  providers: [BudgetsService, BudgetControlService],
  exports: [BudgetControlService],
})
export class BudgetsModule {}