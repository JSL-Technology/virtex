
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { CurrenciesService } from './currencies.service';
import { CurrenciesController } from './currencies.controller';
import { Currency } from './entities/currency.entity';
import { ExchangeRate } from './entities/exchange-rate.entity';
import { ExchangeRatesService } from './exchange-rates.service';
import { ExchangeRatesController } from './exchange-rates.controller';
import { CurrencyRevaluationService } from '../batch-processes/currency-revaluation.service';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';

import { AccountBalance } from '../chart-of-accounts/entities/account-balance.entity';


@Module({
  imports: [
    TypeOrmModule.forFeature([
      Currency,
      ExchangeRate,
      Account,
      OrganizationSettings,
      Journal,
      AccountBalance,
    ]),
    HttpModule,
    forwardRef(() => JournalEntriesModule),
  ],
  controllers: [CurrenciesController, ExchangeRatesController],
  providers: [
    CurrenciesService,
    ExchangeRatesService,
    CurrencyRevaluationService,
  ],
  exports: [CurrencyRevaluationService],
})
export class CurrenciesModule {}