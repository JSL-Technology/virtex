
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntercompanyTransaction } from './entities/intercompany-transaction.entity';
import { IntercompanyService } from './intercompany.service';
import { IntercompanyController } from './intercompany.controller';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { AuthModule } from '../auth/auth.module';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { ExchangeRate } from '../currencies/entities/exchange-rate.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      IntercompanyTransaction,
      Organization,
      OrganizationSettings,
      ExchangeRate,
    ]),
    JournalEntriesModule,
    AuthModule,
  ],
  providers: [IntercompanyService],
  controllers: [IntercompanyController],
})
export class IntercompanyModule {}