
import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from '../invoices/entities/invoice.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { Report } from './entities/report.entity';

@Module({
  imports: [
    InvoicesModule,

    TypeOrmModule.forFeature([Invoice, JournalEntryLine, Account, Report]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}