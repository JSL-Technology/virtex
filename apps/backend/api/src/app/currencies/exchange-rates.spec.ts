import { DataSource } from 'typeorm';
import { ExchangeRate, ExchangeRateType } from './entities/exchange-rate.entity';
import { ExchangeRateResolver } from './exchange-rate-resolver.service';
import { Currency } from './entities/currency.entity';
import { ExchangeRatesService } from './exchange-rates.service';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';

/**
 * Exchange rates: direction, triangulation, type and staleness.
 *
 * Every case here failed before, and none of them abstractly: a tenant whose books are in one
 * currency could not book an invoice in another that had no direct quote, and a tenant looking a
 * pair up backwards recorded a USD 100 invoice as 1.70 of its own currency.
 *
 * The pairs are guaraní, boliviano and Uruguayan peso rather than the pesos the rest of the suite
 * uses. `exchange_rates` is deliberately global — what a currency was worth on a day is a fact
 * about the market, not about a tenant — so a suite cannot isolate itself by organization id the
 * way every other suite does. A currency set no other suite touches is the isolation.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('exchange rates', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let resolver: ExchangeRateResolver;
  let service: ExchangeRatesService;

  const ACTOR = '44444444-4444-4444-8444-444444444444';
  const DAY = '2026-03-15';

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
      entities: [`${__dirname}/../**/*.entity.{js,ts}`],
    });
    await dataSource.initialize();

    resolver = new ExchangeRateResolver(dataSource);
    service = new ExchangeRatesService(
      dataSource.getRepository(ExchangeRate),
      dataSource.getRepository(Currency),
      // The HTTP client and the config are only reached by `updateRates`/`backfill`, which are not
      // exercised here: hitting a metered third-party provider from a test suite is not a test.
      {} as never,
      { get: () => undefined } as never,
      resolver,
      new SchedulerLockService(dataSource),
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  /**
   * `exchange_rates` is deliberately global — what a currency was worth on a day is a fact about
   * the market, not about a tenant — so a suite cannot isolate itself with an organization id the
   * way every other suite does. Clearing the table would delete the rates the payables, receipts
   * and treasury suites publish while they are running. This suite instead works in a currency set
   * no other suite touches and removes only what it wrote.
   */
  beforeEach(async () => {
    // `currencies` is global too, and `record` refuses a code the tenant has not configured — which
    // is correct behaviour and needs the catalogue to contain the codes this suite uses.
    for (const [code, name, symbol] of [
      ['PYG', 'Guaraní', '₲'],
      ['BOB', 'Boliviano', 'Bs'],
      ['UYU', 'Peso uruguayo', '$U'],
      ['USD', 'Dólar estadounidense', '$'],
    ] as const) {
      await dataSource
        .getRepository(Currency)
        .createQueryBuilder()
        .insert()
        .values({ code, name, symbol })
        .orIgnore()
        .execute();
    }

    await dataSource
      .getRepository(ExchangeRate)
      .createQueryBuilder()
      .delete()
      .where('"fromCurrency" IN (:...codes) OR "toCurrency" IN (:...codes)', {
        codes: ['PYG', 'BOB', 'UYU'],
      })
      .execute();
  });

  /** Units of `to` for one unit of `from`, on `date`. */
  async function publish(
    from: string,
    to: string,
    rate: number,
    date = DAY,
    rateType = ExchangeRateType.OFFICIAL,
    source = 'TEST',
  ): Promise<void> {
    await dataSource.getRepository(ExchangeRate).save({
      fromCurrency: from,
      toCurrency: to,
      rate,
      date: date as unknown as Date,
      rateType,
      source,
      recordedByUserId: null,
    });
  }

  it('returns 1 for a domestic document without touching the table', async () => {
    const resolved = await resolver.resolve('PYG', 'PYG', DAY);
    expect(resolved.rate).toBe(1);
    expect(resolved.method).toBe('IDENTITY');
  });

  it('reads a direct quote in the direction it was asked for', async () => {
    await publish('USD', 'PYG', 58.8);
    const resolved = await resolver.resolve('USD', 'PYG', DAY);
    expect(resolved.rate).toBeCloseTo(58.8, 6);
    expect(resolved.method).toBe('DIRECT');
    expect(resolved.source).toBe('TEST');
  });

  /**
   * The invoice bug, in one assertion.
   *
   * Accounts payable looked up `base → foreign` and multiplied the foreign total by it. With books
   * in the local currency and a USD 100 invoice at 58.8, that recorded 100 × 0.017 = 1.70 instead
   * of 5,880.
   */
  it('inverts a quote stored the other way round', async () => {
    await publish('USD', 'PYG', 58.8);
    const resolved = await resolver.resolve('PYG', 'USD', DAY);
    expect(resolved.rate).toBeCloseTo(1 / 58.8, 8);
    expect(resolved.method).toBe('INVERSE');

    const converted = await resolver.convertAmount(100, 'USD', 'PYG', DAY);
    expect(converted.amount).toBeCloseTo(5880, 2);
  });

  /**
   * A tenant on one minor currency invoicing in another. Neither leg of BOB/UYU is on file and
   * never will be: every provider quotes against the dollar. Before triangulation this threw
   * outright, so the invoice simply could not be recorded.
   */
  it('crosses through the dollar when neither leg of the pair is quoted', async () => {
    await publish('USD', 'BOB', 6.9);
    await publish('USD', 'UYU', 40);

    const resolved = await resolver.resolve('BOB', 'UYU', DAY);

    expect(resolved.method).toBe('TRIANGULATED');
    expect(resolved.via).toBe('USD');
    // BOB → USD is 1/6.9; USD → UYU is 40.
    expect(resolved.rate).toBeCloseTo((1 / 6.9) * 40, 6);
    expect(resolved.source).toContain('TEST');
  });

  it('refuses rather than guessing when only one leg of the cross exists', async () => {
    await publish('USD', 'BOB', 6.9);
    await expect(resolver.resolve('BOB', 'UYU', DAY)).rejects.toThrow();
  });

  /**
   * An official rate and a market rate for the same pair on the same day.
   *
   * Impossible under the old unique index on `(from, to, date)`, and this is the normal case in
   * most of the product's markets: the authority publishes one figure and the market quotes
   * another, and a taxpayer is obliged to book at the first.
   */
  it('holds an official and a market rate for the same pair on the same day', async () => {
    await publish('USD', 'PYG', 58.8, DAY, ExchangeRateType.OFFICIAL, 'DGII');
    await publish('USD', 'PYG', 59.45, DAY, ExchangeRateType.MARKET, 'XE');

    const official = await resolver.resolve('USD', 'PYG', DAY, undefined, ExchangeRateType.OFFICIAL);
    const market = await resolver.resolve('USD', 'PYG', DAY, undefined, ExchangeRateType.MARKET);

    expect(official.rate).toBeCloseTo(58.8, 6);
    expect(official.source).toBe('DGII');
    expect(market.rate).toBeCloseTo(59.45, 6);
    expect(market.source).toBe('XE');
  });

  it('falls back from official to market rather than blocking a posting, and says so', async () => {
    await publish('USD', 'PYG', 59.45, DAY, ExchangeRateType.MARKET, 'XE');
    const resolved = await resolver.resolve('USD', 'PYG', DAY, undefined, ExchangeRateType.OFFICIAL);
    expect(resolved.rate).toBeCloseTo(59.45, 6);
    expect(resolved.rateType).toBe(ExchangeRateType.MARKET);
  });

  /**
   * The newest quote at or before the date, and it reports how old that is.
   *
   * A six-month-stale rate converted as confidently as this morning's and said nothing. `quotedOn`
   * is what lets a caller refuse one.
   */
  it('takes the newest quote at or before the date and reports when it was quoted', async () => {
    await publish('USD', 'PYG', 57.0, '2026-01-10');
    await publish('USD', 'PYG', 58.8, '2026-03-01');
    await publish('USD', 'PYG', 60.0, '2026-04-01');

    const resolved = await resolver.resolve('USD', 'PYG', DAY);
    expect(resolved.rate).toBeCloseTo(58.8, 6);
    expect(resolved.quotedOn).toBe('2026-03-01');
    expect(resolved.date).toBe(DAY);
  });

  /**
   * A `date` column compared against a calendar day, not a timestamp.
   *
   * The old lookup built `new Date(issueDate)` — midnight UTC — and in one caller a
   * `23:59:59.999Z` end-of-day, which pulls in the following day either side of a timezone
   * boundary. A rate published *on* the document's date must be the one used.
   */
  it('uses a rate published on the document date itself', async () => {
    await publish('USD', 'PYG', 58.8, DAY);
    const resolved = await resolver.resolve('USD', 'PYG', DAY);
    expect(resolved.quotedOn).toBe(DAY);
  });

  it('refuses a date with no quote at or before it', async () => {
    await publish('USD', 'PYG', 58.8, '2026-06-01');
    await expect(resolver.resolve('USD', 'PYG', DAY)).rejects.toThrow();
  });

  // ── Recording by hand ─────────────────────────────────────────────────────

  it('records a rate by hand with its source and its author', async () => {
    const result = await service.record(
      {
        fromCurrency: 'usd',
        toCurrency: 'pyg',
        rate: 58.75,
        date: DAY,
        rateType: ExchangeRateType.OFFICIAL,
        source: 'dgii',
      },
      ACTOR,
    );

    expect(result.rate.fromCurrency).toBe('USD');
    expect(result.rate.source).toBe('DGII');
    expect(result.rate.recordedByUserId).toBe(ACTOR);

    const resolved = await resolver.resolve('USD', 'PYG', DAY);
    expect(resolved.rate).toBeCloseTo(58.75, 6);
  });

  /**
   * Correcting a mistyped rate is the same act as entering it.
   *
   * The scheduled refresh used `save`, which appended a row every run, and the lookups order by
   * date and take the first — so among same-day duplicates the answer was whichever PostgreSQL
   * happened to return. The same invoice could convert two different ways.
   */
  it('corrects a rate in place instead of leaving two rows for the same day', async () => {
    await service.record(
      { fromCurrency: 'USD', toCurrency: 'PYG', rate: 5.88, date: DAY },
      ACTOR,
    );
    await service.record(
      { fromCurrency: 'USD', toCurrency: 'PYG', rate: 58.8, date: DAY },
      ACTOR,
    );

    const rows = await dataSource.getRepository(ExchangeRate).find({
      where: { fromCurrency: 'USD', toCurrency: 'PYG' },
    });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].rate)).toBeCloseTo(58.8, 6);
  });

  it('refuses a pair with the same currency on both sides', async () => {
    await expect(
      service.record({ fromCurrency: 'USD', toCurrency: 'USD', rate: 1, date: DAY }, ACTOR),
    ).rejects.toThrow();
  });

  it('refuses a non-positive rate', async () => {
    await expect(
      service.record({ fromCurrency: 'USD', toCurrency: 'PYG', rate: 0, date: DAY }, ACTOR),
    ).rejects.toThrow();
  });

  it('refuses a backfill range that runs backwards', async () => {
    await expect(
      service.backfill({ startDate: '2026-03-31', endDate: '2026-03-01' }),
    ).rejects.toThrow();
  });

  it('refuses a backfill range wider than the day limit', async () => {
    await expect(
      service.backfill({ startDate: '2026-01-01', endDate: '2026-03-01', maxDays: 5 }),
    ).rejects.toThrow();
  });

  it('refuses to backfill dates that have not happened yet', async () => {
    await expect(
      service.backfill({ startDate: '2099-01-01', endDate: '2099-01-05' }),
    ).rejects.toThrow();
  });

  it('explains a rate through the route the controller serves', async () => {
    await publish('USD', 'BOB', 6.9);
    await publish('USD', 'UYU', 40);

    const explained = await service.explain('BOB', 'UYU', DAY);
    expect(explained.method).toBe('TRIANGULATED');
    expect(explained.via).toBe('USD');
  });
});
