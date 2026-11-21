import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { CurrenciesService } from './currencies.service';
import { CurrencySeederService } from './currency-seeder.service';
import { CurrenciesController } from './currencies.controller';
import { Currency } from './entities/currency.entity';
import { TenantExchangeRate } from './entities/tenant-exchange-rate.entity';
import { ExchangeRate } from './entities/exchange-rate.entity';
import { ExchangeRatesService } from './exchange-rates.service';
import { ExchangeRatesController } from './exchange-rates.controller';
import { ExchangeRateResolver } from './exchange-rate-resolver.service';
import { XeRatesProvider } from './xe-rates.provider';

// CurrencyRevaluationService moved to accounting/services/ — it belongs to the accounting
// domain and now injects AccountingPostingPort instead of JournalEntriesService.
// AccountingModule provides and exports it from there.

@Module({
  // `ChartOfAccountsModule` was imported here behind a `forwardRef`, and the comment explaining
  // the `forwardRef` described the cycle that the import itself created: currencies is platform,
  // chart-of-accounts is the ledger, and nothing in this folder used a single provider from it —
  // `CurrencyRevaluationService` had already moved to `accounting/`, which is where it belongs.
  // Removing the import removed the cycle and the workaround together.
  imports: [
    TypeOrmModule.forFeature([Currency, ExchangeRate, TenantExchangeRate]),
    HttpModule,
  ],
  controllers: [CurrenciesController, ExchangeRatesController],
  providers: [
    ExchangeRateResolver,
    XeRatesProvider,
    CurrenciesService,
    CurrencySeederService,
    ExchangeRatesService,
  ],
  exports: [ExchangeRateResolver, XeRatesProvider, CurrencySeederService],
})
export class CurrenciesModule {}