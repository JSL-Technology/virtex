import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TenantExchangeRate } from './entities/tenant-exchange-rate.entity';
import { ExchangeRate, ExchangeRateType } from './entities/exchange-rate.entity';
import { Currency } from './entities/currency.entity';
import { ExchangeRateResolver, ResolvedRate } from './exchange-rate-resolver.service';
import { BackfillRatesDto, ImportRatesDto, RateHistoryQueryDto, RateScope, RecordRateDto } from './dto/exchange-rate.dto';
import { LocalizedResult } from '../i18n/localized-message';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { addDaysIso, daysBetween, toIsoDate, todayIso } from '../common/dates';
import { roundAmount } from '../common/money';
import { XeRatesProvider } from './xe-rates.provider';

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

/** A rate as the history shows it, and whose it is. */
export interface RateHistoryRow {
  id: string;
  scope: 'TENANT' | 'SHARED';
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  date: string;
  rateType: ExchangeRateType;
  source: string;
  recordedByUserId: string | null;
}

/** A rate ready to store in the company's table. */
interface NormalisedRate {
  organizationId: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  date: string;
  rateType: ExchangeRateType;
  source: string;
  recordedByUserId: string | null;
}

export interface RateHistoryPage {
  items: RateHistoryRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/** How many upstream calls a single backfill may make. One request per day, one bill per request. */
const MAX_BACKFILL_DAYS = 370;

/** The provider name written to `source` for anything the scheduled refresh brings in. */
const PROVIDER = 'XE';

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

  constructor(
    @InjectRepository(ExchangeRate)
    private readonly exchangeRateRepository: Repository<ExchangeRate>,
    @InjectRepository(TenantExchangeRate)
    private readonly tenantRateRepository: Repository<TenantExchangeRate>,
    @InjectRepository(Currency)
    private readonly currencyRepository: Repository<Currency>,
    private readonly configService: ConfigService,
    private readonly resolver: ExchangeRateResolver,
    private readonly schedulerLock: SchedulerLockService,
    private readonly xe: XeRatesProvider,
  ) {}

  /**
   * Refuse to store rates the provider itself says are made up. No exceptions, no environments.
   *
   * XE serves **mock rates** on the free trial — its own credentials screen states it under "Free
   * Trial Rates". A mock rate written to `exchange_rates` is indistinguishable from a real one the
   * instant it lands: it carries the same source, the same date and the same type. Every
   * foreign-currency invoice, every period-end revaluation and every realised exchange difference
   * computed from it is then a fabricated figure inside a book a tax authority reads, and there is
   * no way to find them afterwards or to unwind the entries they produced.
   *
   * There is deliberately no flag to turn this off. A development environment that needs rates has
   * two honest ways to get them: a paid XE plan, or `POST /exchange-rates` — which is a real rate,
   * entered by a person, attributed to them, and typed as official or market. Neither invents a
   * number.
   */
  private async assertProviderServesRealRates(): Promise<void> {
    const account = await this.xe.accountInfo();
    if (!account.servesMockRates) return;

    this.logger.error(
      `La cuenta de XE está en el plan "${account.package}", que devuelve tasas simuladas. ` +
        'No se almacenará ninguna tasa. Contrate un plan con datos reales, o registre las tasas ' +
        'oficiales con POST /exchange-rates.',
    );
    throw new BadRequestError('currencies.provider_account_plan_plan_which_returns', {
      provider: PROVIDER,
      plan: account.package,
    });
  }

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
      return { messageKey: 'currencies.no_currencies_update', rates_updated: 0 };
    }
    return {
      messageKey: 'currencies.exchange_rates_updated',
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
      throw new BadRequestError('currencies.invalid_date_range_start_date_later', {
        startDate,
        endDate,
      });
    }

    const today = todayIso();
    if (endDate > today) {
      throw new BadRequestError('currencies.future_rates_cannot_requested_end_date', { endDate, today });
    }

    const limit = Math.min(dto.maxDays ?? MAX_BACKFILL_DAYS, MAX_BACKFILL_DAYS);
    const days = daysBetween(startDate, endDate) + 1;
    if (days > limit) {
      throw new BadRequestError('currencies.requested_range_spans_days_days_maximum', { days, limit });
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
      messageKey: 'currencies.historical_backfill_complete_days_days_processed',
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
    actorUserId: string | undefined,
    organizationId: string,
  ): Promise<LocalizedResult<{ rate: TenantExchangeRate }>> {
    const row = await this.normalise(dto, actorUserId, organizationId);
    // Into the TENANT's own table. Writing the shared one let one customer's typed rate convert
    // every other customer's documents; the resolver prefers this row for this tenant only.
    await this.tenantRateRepository.upsert([row], ['organizationId', 'fromCurrency', 'toCurrency', 'date', 'rateType']);
    const stored = await this.tenantRateRepository.findOneByOrFail({
      organizationId,
      fromCurrency: row.fromCurrency,
      toCurrency: row.toCurrency,
      date: row.date,
      rateType: row.rateType,
    });
    return { messageKey: 'currencies.exchange_rate_recorded_successfully', rate: stored };
  }

  /**
   * Record many rates at once — the authority's table for a month, pasted from a spreadsheet.
   *
   * All or nothing: a file with one bad row is refused whole, with the row named, because half a
   * month of rates is a month in which some documents convert and others cannot, for no reason a
   * person can see.
   */
  async importRates(
    dto: ImportRatesDto,
    actorUserId: string | undefined,
    organizationId: string,
  ): Promise<LocalizedResult<{ imported: number }>> {
    const rows: NormalisedRate[] = [];
    const seen = new Set<string>();
    for (const [index, line] of dto.rates.entries()) {
      try {
        const row = await this.normalise(line, actorUserId, organizationId);
        const key = `${row.fromCurrency}|${row.toCurrency}|${row.date}|${row.rateType}`;
        if (seen.has(key)) {
          throw new BadRequestError('currencies.import_duplicate_rate', { pair: `${row.fromCurrency}/${row.toCurrency}`, date: row.date });
        }
        seen.add(key);
        rows.push(row);
      } catch (error) {
        if (error instanceof BadRequestError) {
          throw new BadRequestError('currencies.import_row_invalid', { row: index + 1, reason: error.messageKey });
        }
        throw error;
      }
    }
    await this.tenantRateRepository.manager.transaction(async (manager) => {
      for (let start = 0; start < rows.length; start += 500) {
        await manager.upsert(TenantExchangeRate, rows.slice(start, start + 500), [
          'organizationId',
          'fromCurrency',
          'toCurrency',
          'date',
          'rateType',
        ]);
      }
    });
    return { messageKey: 'currencies.exchange_rates_imported', imported: rows.length };
  }

  /**
   * The rates a company has to look at: its own, and the shared market table it falls back to —
   * newest first. The shared table is filtered to the pairs this list is about; without a currency
   * it is every pair the provider quotes, which is what an auditor asks to see.
   */
  async history(organizationId: string, query: RateHistoryQueryDto): Promise<RateHistoryPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 100;
    const scope = query.scope ?? RateScope.ALL;
    const params: unknown[] = [organizationId];
    const where = (fromCol: string, toCol: string): string => {
      const clauses: string[] = [];
      if (query.currency) {
        params.push(query.currency.toUpperCase());
        clauses.push(`(${fromCol} = $${params.length} OR ${toCol} = $${params.length})`);
      }
      if (query.rateType) {
        params.push(query.rateType);
        clauses.push(`rate_type = $${params.length}`);
      }
      if (query.from) {
        params.push(toIsoDate(query.from));
        clauses.push(`date >= $${params.length}`);
      }
      if (query.to) {
        params.push(toIsoDate(query.to));
        clauses.push(`date <= $${params.length}`);
      }
      return clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
    };
    const parts: string[] = [];
    if (scope !== RateScope.SHARED) {
      parts.push(`
        SELECT id, 'TENANT' AS scope, from_currency AS "fromCurrency", to_currency AS "toCurrency", rate,
               TO_CHAR(date, 'YYYY-MM-DD') AS date, rate_type AS "rateType", source,
               recorded_by_user_id AS "recordedByUserId"
          FROM tenant_exchange_rates
         WHERE organization_id = $1${where('from_currency', 'to_currency')}`);
    }
    if (scope !== RateScope.TENANT) {
      // tenant-scope-guard-allow: the shared table holds market facts, not tenant data.
      parts.push(`
        SELECT id, 'SHARED' AS scope, "fromCurrency", "toCurrency", rate,
               TO_CHAR(date, 'YYYY-MM-DD') AS date, rate_type AS "rateType", source,
               recorded_by_user_id AS "recordedByUserId"
          FROM exchange_rate
         WHERE $1::uuid IS NOT NULL${where('"fromCurrency"', '"toCurrency"')}`);
    }
    const union = parts.join(' UNION ALL ');
    const [{ total }] = await this.tenantRateRepository.query(`SELECT COUNT(*)::int AS total FROM (${union}) r`, params);
    const rows = await this.tenantRateRepository.query(
      `SELECT * FROM (${union}) r ORDER BY date DESC, "fromCurrency", "toCurrency", scope DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    return {
      items: rows.map((row: RateHistoryRow) => ({ ...row, rate: Number(row.rate) })),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /** Remove a rate the company recorded. The shared table is not the company's to edit. */
  async remove(id: string, organizationId: string): Promise<void> {
    const row = await this.tenantRateRepository.findOneBy({ id, organizationId });
    if (!row) throw new NotFoundError('currencies.exchange_rate_not_found');
    await this.tenantRateRepository.delete({ id, organizationId });
  }

  /** One rate, validated and in the shape both `record` and `importRates` store. */
  private async normalise(
    dto: RecordRateDto,
    actorUserId: string | undefined,
    organizationId: string,
  ): Promise<NormalisedRate> {
    const fromCurrency = dto.fromCurrency.toUpperCase();
    const toCurrency = dto.toCurrency.toUpperCase();
    if (fromCurrency === toCurrency) {
      throw new BadRequestError('currencies.currency_pair_cannot_have_same_currency', { currency: fromCurrency });
    }
    await this.requireKnownCurrencies([fromCurrency, toCurrency]);
    const rate = roundAmount(dto.rate, 6);
    if (!(rate > 0)) {
      throw new BadRequestError('currencies.exchange_rate_must_greater_than_zero', { rate: dto.rate });
    }
    return {
      organizationId,
      fromCurrency,
      toCurrency,
      rate,
      date: toIsoDate(dto.date),
      rateType: dto.rateType ?? ExchangeRateType.OFFICIAL,
      source: dto.source?.toUpperCase() ?? 'MANUAL',
      recordedByUserId: actorUserId ?? null,
    };
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
    if (!this.xe.isConfigured()) {
      throw new BadRequestError('currencies.no_exchange_rate_provider_configured_record');
    }

    await this.assertProviderServesRealRates();

    // tenant-scope-guard-allow: currencies are global reference data shared across all tenants.
    const currencies = await this.currencyRepository.find();
    const targets = currencies.map((c) => c.code.toUpperCase()).filter((code) => code !== PIVOT);

    if (targets.length === 0) {
      this.logger.warn('No hay divisas configuradas para actualizar.');
      return 0;
    }

    const quotes = await this.xe.fetchMidRates(PIVOT, targets, day);
    if (quotes.length === 0) {
      throw new BadRequestError('currencies.provider_response_contains_no_rates_date', { date: day });
    }

    const rows = quotes.map((quote) => ({
      fromCurrency: PIVOT,
      toCurrency: quote.currency,
      rate: quote.rate,
      date: day as unknown as Date,
      // XE publishes an interbank mid. Calling it OFFICIAL would let it satisfy a lookup for the
      // rate a tax authority mandates, which it is not and never was.
      rateType: ExchangeRateType.MARKET,
      source: PROVIDER,
      recordedByUserId: null,
    }));

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
    // tenant-scope-guard-allow: currencies are global reference data shared across all tenants.
    const known = await this.currencyRepository.find();
    const catalogue = new Set(known.map((c) => c.code.toUpperCase()));
    // An empty catalogue means currency seeding has not run; refusing every rate in that state
    // would be worse than accepting one.
    if (catalogue.size === 0) return;

    const unknown = codes.filter((code) => !catalogue.has(code));
    if (unknown.length > 0) {
      throw new BadRequestError('currencies.currency_not_configured_codes', { codes: unknown.join(', ') });
    }
  }
}
