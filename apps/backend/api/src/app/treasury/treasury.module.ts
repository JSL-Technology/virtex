import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TreasuryService } from './treasury.service';
import { TreasuryController } from './treasury.controller';
import { BankTransfer } from './entities/bank-transfer.entity';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BankTransfer]),
    JournalEntriesModule,
    AuthModule,
  ],
  controllers: [TreasuryController],
  providers: [TreasuryService],
})
export class TreasuryModule {}