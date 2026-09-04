import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';
import { ExchangeRate, ExchangeRateType } from './entities/exchange-rate.entity';
import { Currency } from './entities/currency.entity';
import { ExchangeRateResolver, ResolvedRate } from './exchange-rate-resolver.service';
import { BackfillRatesDto, RecordRateDto } from './dto/exchange-rate.dto';
import { LocalizedResult } from '../i18n/localized-message';
import { BadRequestError } from '../i18n/localized.exception';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { addDaysIso, daysBetween, toIsoDate, todayIso } from '../common/dates';
import { roundAmount } from '../common/money';

/**
 * The pivot the daily refresh quotes against.
 *
 * Every provider publishes against the dollar and the resolver triangulates through it, so one
 * request per day yields every cross rate a tenant can need. The refresh used to quote against a
 * single process-wide `BASE_CURRENCY` environment variable instead — one value for every tenant on
 * the deployment — which meant a Colombian tenant on a deployment configured for the Dominican
 * Republic accumulated DOP pairs it would never use and had no COP pair at all.
 */
const PIVOT = 'USD';

/** How many upstream calls a single backfill may make. One request per day, one bill per request. */
const MAX_BACKFILL_DAYS = 370;

/** The provider name written to `source` for anything the scheduled refresh brings in. */
const PROVIDER = 'XE';

interface XeHistoricalResponse {
  to?: Record<string, unknown>;
}

/**
 * Publishing exchange rates: the scheduled refresh, historical backfill, and manual entry.
 *
 * ## Three things this had to grow
 *
 * 1. **It only ever asked for today.** A tenant that started on Monday had no rate for any date
 *    before Monday, so a back-dated foreign-currency invoice could not be recorded at all — and
 *    nothing said why: the resolver threw "no rate found" and the user had no way to supply one.
 *    `backfill` fills a range; `record` enters one by hand.
 * 2. **It quoted against one global base.** `BASE_CURRENCY` is a deployment-wide environment
 *    variable, and the pairs it produced were useless to every tenant that did not share it.
 *    Quoting against the dollar and letting the resolver triangulate serves all of them from the
 *    same rows.
 * 3. **Everything it stored was a market rate presented as fact.** Xe publishes an interbank mid.
 *    In most of this product's markets the rate a taxpayer is *obliged* to book at is published by
 *    the tax authority and differs from the mid. Rates now carry their type and their source, so a
 *    tenant can keep its books at the official rate, enter it when no API serves it, and prove
 *    afterwards where each figure came from.
 *
 * ## Why there is no official-rate scraper here
 *
 * DGII, DOF, TRM, BCRA and SUNAT each publish through a different channel, several of them HTML
 * pages with no contract and no availability guarantee. A scraper that silently returns a stale or
 * misparsed figure is worse than no scraper, because the figure it produces is the one the books
 * are kept at. Official rates therefore enter through `record` — audited, attributed, and typed —
 * until a per-jurisdiction feed with an actual contract is added behind the same interface.
 */
@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);
  private readonly xeApiBaseUrl = 'https://xecdapi.xe.com/v1';

  constructor(
    @InjectRepository(ExchangeRate)
    private readonly exchangeRateRepository: Repository<ExchangeRate>,
    @InjectRepository(Currency)
    private readonly currencyRepository: Repository<Currency>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly resolver: ExchangeRateResolver,
    private readonly schedulerLock: SchedulerLockService,
  ) {}

  /**
   * The daily refresh.
   *
   * Claimed through `SchedulerLockService` so two replicas do not both spend the provider's quota
   * on the same day, and so a day already fetched is not fetched again after a restart. A missing
   * or failing provider is logged, not thrown: an unhandled rejection inside a cron handler takes
   * down the process, and a deployment that has not configured a rate provider is a supported
   * configuration — such a tenant enters its rates by hand.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCron(): Promise<void> {
    const day = todayIso();
    try {
      await this.schedulerLock.runOnce('exchange-rates-refresh', day, async () => {
        await this.fetchAndStore(day);
      });
    } catch (error) {
      this.logger.error(
        `No se pudieron actualizar las tasas de cambio del ${day}: ${(error as Error).message}`,
      );
    }
  }

  /** Refresh today's rates on demand. */
  async updateRates(): Promise<LocalizedResult<{ rates_updated: number }>> {
    const stored = await this.fetchAndStore(todayIso());
    if (stored === 0) {
      return { messageKey: 'CURRENCIES.NO_HAY_DIVISAS_PARA_ACTUALIZAR', rates_updated: 0 };
    }
    return {
      messageKey: 'CURRENCIES.TASAS_CAMBIO_ACTUALIZADAS_EXITOSAMENTE',
      rates_updated: stored,
    };
  }

  /**
   * Fetch every day in a closed range.
   *
   * Sequential on purpose: this is a metered upstream and a parallel fan-out over a year is the
   * request that gets the account rate-limited. A day that fails does not abort the range — a gap
   * in the middle of a backfill is worth reporting, not worth discarding the days either side of.
   */
  async backfill(
    dto: BackfillRatesDto,
  ): Promise<LocalizedResult<{ days: number; rates_updated: number; failed_days: string[] }>> {
    const startDate = toIsoDate(dto.startDate);
    const endDate = toIsoDate(dto.endDate);

    if (endDate < startDate) {
      throw new BadRequestError('CURRENCIES.RANGO_FECHAS_INVALIDO', {
        startDate,
        endDate,
      });
    }

    const today = todayIso();
    if (endDate > today) {
      throw new BadRequestError('CURRENCIES.RANGO_FECHAS_FUTURO', { endDate, today });
    }

    const limit = Math.min(dto.maxDays ?? MAX_BACKFILL_DAYS, MAX_BACKFILL_DAYS);
    const days = daysBetween(startDate, endDate) + 1;
    if (days > limit) {
      throw new BadRequestError('CURRENCIES.RANGO_FECHAS_EXCEDE_LIMITE', { days, limit });
    }

    let updated = 0;
    const failedDays: string[] = [];

    for (let day = startDate; day <= endDate; day = addDaysIso(day, 1)) {
      try {
        updated += await this.fetchAndStore(day);
      } catch (error) {
        failedDays.push(day);
        this.logger.warn(`Sin tasas para el ${day}: ${(error as Error).message}`);
      }
    }

    return {
      messageKey: 'CURRENCIES.RELLENO_HISTORICO_COMPLETADO',
      messageParams: { days, updated, failed: failedDays.length },
      days,
      rates_updated: updated,
      failed_days: failedDays,
    };
  }

  /**
   * Record or correct one rate by hand.
   *
   * The route that makes an official rate usable. It upserts on the natural key — pair, day and
   * type — because correcting a rate someone mistyped is the same act as entering it, and a second
   * row for the same day is a rate the resolver would pick between arbitrarily.
   */
  async record(
    dto: RecordRateDto,
    actorUserId?: string,
  ): Promise<LocalizedResult<{ rate: ExchangeRate }>> {
    const fromCurrency = dto.fromCurrency.toUpperCase();
    const toCurrency = dto.toCurrency.toUpperCase();

    if (fromCurrency === toCurrency) {
      throw new BadRequestError('CURRENCIES.PAR_IDENTICO', { currency: fromCurrency });
    }

    await this.requireKnownCurrencies([fromCurrency, toCurrency]);

    const date = toIsoDate(dto.date);
    const rateType = dto.rateType ?? ExchangeRateType.OFFICIAL;
    const rate = roundAmount(dto.rate, 6);

    if (!(rate > 0)) {
      throw new BadRequestError('CURRENCIES.TASA_DEBE_SER_POSITIVA', { rate: dto.rate });
    }

    await this.exchangeRateRepository.upsert(
      [
        {
          fromCurrency,
          toCurrency,
          rate,
          date: date as unknown as Date,
          rateType,
          source: dto.source?.toUpperCase() ?? 'MANUAL',
          recordedByUserId: actorUserId ?? null,
        },
      ],
      ['fromCurrency', 'toCurrency', 'date', 'rateType'],
    );

    const stored = await this.exchangeRateRepository.findOneByOrFail({
      fromCurrency,
      toCurrency,
      date: date as unknown as Date,
      rateType,
    });

    return { messageKey: 'CURRENCIES.TASA_REGISTRADA', rate: stored };
  }

  /**
   * The rate a document dated `date` would be converted at, and how it was arrived at.
   *
   * Exposed as a route because "which rate did this posting use, and where did it come from" is
   * the first question of any foreign-currency audit, and nothing could answer it.
   */
  explain(
    from: string,
    to: string,
    date: string,
    rateType?: ExchangeRateType,
  ): Promise<ResolvedRate> {
    return this.resolver.resolve(from, to, toIsoDate(date), undefined, rateType);
  }

  /**
   * Fetch one day's quotes from the provider and store them.
   *
   * @returns how many rates were written.
   */
  private async fetchAndStore(day: string): Promise<number> {
    const apiKey = this.configService.get<string>('XE_API_KEY');
    const apiId = this.configService.get<string>('XE_API_ID');

    if (!apiKey || !apiId) {
      throw new BadRequestError('CURRENCIES.PROVEEDOR_TASAS_NO_CONFIGURADO');
    }

    const currencies = await this.currencyRepository.find();
    const targets = currencies.map((c) => c.code.toUpperCase()).filter((code) => code !== PIVOT);

    if (targets.length === 0) {
      this.logger.warn('No hay divisas configuradas para actualizar.');
      return 0;
    }

    const auth = 'Basic ' + Buffer.from(`${apiId}:${apiKey}`).toString('base64');
    const url =
      `${this.xeApiBaseUrl}/rates/historical.json` +
      `?from=${PIVOT}&to=${targets.join(',')}&date=${day}`;

    let payload: XeHistoricalResponse;
    try {
      const response = await firstValueFrom(
        this.httpService.get<XeHistoricalResponse>(url, { headers: { Authorization: auth } }),
      );
      payload = response.data;
    } catch (error) {
      const detail =
        (error as AxiosError).response?.data ?? (error as Error).message ?? 'error desconocido';
      this.logger.error(
        `Error al obtener las tasas de cambio del ${day}: ${JSON.stringify(detail)}`,
      );
      throw new BadRequestError('CURRENCIES.NO_SE_PUDIERON_OBTENER_TASAS', { date: day });
    }

    const quotes = payload?.to;
    if (!quotes || typeof quotes !== 'object') {
      throw new BadRequestError('CURRENCIES.RESPUESTA_PROVEEDOR_SIN_TASAS', { date: day });
    }

    const rows = Object.entries(quotes)
      .map(([code, value]) => ({
        fromCurrency: PIVOT,
        toCurrency: code.toUpperCase(),
        rate: roundAmount(Number(value), 6),
        date: day as unknown as Date,
        // Xe publishes an interbank mid. Calling it OFFICIAL would let it satisfy a lookup for the
        // rate a tax authority mandates, which it is not and never was.
        rateType: ExchangeRateType.MARKET,
        source: PROVIDER,
        recordedByUserId: null,
      }))
      // A provider returning a null, a zero or a non-numeric quote for a thin pair is normal.
      // Storing it would make every conversion through that pair silently wrong.
      .filter((row) => Number.isFinite(row.rate) && row.rate > 0);

    if (rows.length === 0) return 0;

    // Upsert on the pair, the day and the type. `save` appended a new row on every run, so a table
    // with no uniqueness constraint accumulated one duplicate per currency per refresh — and the
    // lookups, which order by date and take the first row, then picked among same-day duplicates
    // arbitrarily. The same invoice could convert two different ways.
    await this.exchangeRateRepository.upsert(rows, [
      'fromCurrency',
      'toCurrency',
      'date',
      'rateType',
    ]);

    this.logger.log(`Se almacenaron ${rows.length} tasas de cambio del ${day}.`);
    return rows.length;
  }

  /**
   * Refuse a pair naming a currency the tenant has not configured.
   *
   * Without this, a typo enters a rate for a currency code that exists nowhere else in the system,
   * where it sits until someone wonders why `EURO` has no quotes.
   */
  private async requireKnownCurrencies(codes: string[]): Promise<void> {
    const known = await this.currencyRepository.find();
    const catalogue = new Set(known.map((c) => c.code.toUpperCase()));
    // An empty catalogue means currency seeding has not run; refusing every rate in that state
    // would be worse than accepting one.
    if (catalogue.size === 0) return;

    const unknown = codes.filter((code) => !catalogue.has(code));
    if (unknown.length > 0) {
      throw new BadRequestError('CURRENCIES.DIVISA_DESCONOCIDA', { codes: unknown.join(', ') });
    }
  }
}
