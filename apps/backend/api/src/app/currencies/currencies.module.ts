import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { CurrenciesService } from './currencies.service';
import { CurrencySeederService } from './currency-seeder.service';
import { CurrenciesController } from './currencies.controller';
import { Currency } from './entities/currency.entity';
import { ExchangeRate } from './entities/exchange-rate.entity';
import { ExchangeRatesService } from './exchange-rates.service';
import { ExchangeRatesController } from './exchange-rates.controller';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
import { ExchangeRateResolver } from './exchange-rate-resolver.service';
import { XeRatesProvider } from './xe-rates.provider';

// CurrencyRevaluationService moved to accounting/services/ — it belongs to the accounting
// domain and now injects AccountingPostingPort instead of JournalEntriesService.
// AccountingModule provides and exports it from there.

@Module({
  imports: [
    // `forwardRef` because the graph really is circular: ChartOfAccountsModule reaches
    // JournalEntriesModule, which reaches back here. Without it the class expression is still
    // being evaluated when this module is defined, so `imports[0]` is literally `undefined` and
    // Nest fails to build the container — which is what stopped the application booting at all.
    forwardRef(() => ChartOfAccountsModule),
    TypeOrmModule.forFeature([Currency, ExchangeRate]),
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