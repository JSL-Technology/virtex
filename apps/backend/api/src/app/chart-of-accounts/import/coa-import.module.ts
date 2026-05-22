
import { Module } from '@nestjs/common';
import { CoaImportController } from './coa-import.controller';
import { CoaImportService } from './coa-import.service';
import { ChartOfAccountsModule } from '../chart-of-accounts.module';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { WebsocketsModule } from '../websockets/websockets.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    ChartOfAccountsModule,
    JournalEntriesModule,
    WebsocketsModule,
    AuthModule
  ],
  controllers: [CoaImportController],
  providers: [CoaImportService]
})
export class CoaImportModule {}
