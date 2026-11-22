import { DataSource } from 'typeorm';
import { ExchangeRate, ExchangeRateType } from './entities/exchange-rate.entity';
import { ExchangeRateResolver } from './exchange-rate-resolver.service';
import { testExchangeRateResolver } from './exchange-rate-resolver.testing';
import { XeRatesProvider } from './xe-rates.provider';
import { Currency } from './entities/currency.entity';
import { ExchangeRatesService } from './exchange-rates.service';
import { RateScope } from './dto/exchange-rate.dto';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { TenantExchangeRate } from './entities/tenant-exchange-rate.entity';
import { runInTenantContext } from '../shared/tenancy/tenant-context';
import { ChangeAuditPort, TransactionalChange } from '../contracts/audit/access-audit.contract';
import { collectNotices, RequestNotice } from '../i18n/request-notices';

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
  // Tenants are created through the entity's registered name: this module holds tenant ids, it
  // does not depend on Identity's classes.
  let tenantA: { id: string };
  let tenantB: { id: string };

  /** As the resolver sees it when a request or a job acts for `organizationId`. */
  const asTenant = <T>(organizationId: string, work: () => Promise<T>): Promise<T> =>
    runInTenantContext({ organizationId, manager: dataSource.manager }, work);

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

    resolver = testExchangeRateResolver(dataSource);
    tenantA = { id: (await dataSource.getRepository('Organization').save({ legalName: `FX A ${Date.now()}` })).id };
    tenantB = { id: (await dataSource.getRepository('Organization').save({ legalName: `FX B ${Date.now()}` })).id };

    service = new ExchangeRatesService(
      dataSource.getRepository(ExchangeRate),
      dataSource.getRepository(TenantExchangeRate),
      dataSource.getRepository(Currency),
      { get: () => undefined } as never,
      resolver,
      new SchedulerLockService(dataSource),
      // The provider is only reached by `updateRates`/`backfill`, which this suite does not
      // exercise: calling a metered third party from a test suite is not a test, and XE's own
      // contract is pinned in `xe-rates.provider.spec.ts`. What is under test here is resolution,
      // triangulation, staleness and manual recording, all of which read the database.
      new XeRatesProvider({ get: () => undefined } as never, { get: () => undefined } as never),
      trailPort,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        `DELETE FROM tenant_exchange_rates WHERE from_currency IN ('PYG','BOB','UYU') OR to_currency IN ('PYG','BOB','UYU')`,
      );
      await dataSource.query(`DELETE FROM exchange_rate WHERE "fromCurrency" IN ('PYG','BOB','UYU') OR "toCurrency" IN ('PYG','BOB','UYU')`);
    }
    await dataSource?.destroy();
  });

  /**
   * What the service reports to the audit trail (FINB-05), through the port the audit module
   * implements — and whether it reported it INSIDE the transaction that wrote the rate, which is
   * what makes the row commit or roll back with it. That the port's rows reach `audit_logs` is the
   * audit module's to prove (`audit/change-audit.adapter.spec.ts`), and the whole path, over HTTP,
   * is `npm run verify:exchange-rates`.
   */
  let recorded: Array<TransactionalChange & { inTransaction: boolean }> = [];
  const trailPort = {
    recordChange: async () => undefined,
    actorsOf: async () => [],
    recordChangesWithin: async (manager, changes) => {
      const inTransaction = Boolean(manager.queryRunner?.isTransactionActive);
      recorded.push(...changes.map((change) => ({ ...change, inTransaction })));
    },
  } satisfies ChangeAuditPort;
  const markTrail = () => {
    recorded = [];
  };
  const trail = (organizationId: string) =>
    recorded
      .filter((change) => change.organizationId === organizationId && change.entity === 'tenant_exchange_rates')
      .map((change) => ({
        action: change.action,
        entityId: change.entityId,
        userId: change.userId,
        newValue: change.after as Record<string, unknown>,
        previousValue: change.before as Record<string, unknown> | null,
        inTransaction: change.inTransaction,
      }));

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
    await dataSource.query(
      `DELETE FROM tenant_exchange_rates WHERE from_currency IN ('PYG','BOB','UYU') OR to_currency IN ('PYG','BOB','UYU')`,
    );
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
    // Inside a request, as a posting resolves it: «says so» means to the person posting, not only to
    // the server's log (FINB-06).
    const notices: RequestNotice[] = [];
    const resolved = await collectNotices(notices, () => resolver.resolve('USD', 'PYG', DAY, undefined, ExchangeRateType.OFFICIAL));
    expect(resolved.rate).toBeCloseTo(59.45, 6);
    expect(resolved.rateType).toBe(ExchangeRateType.MARKET);
    expect(resolved.substitutedFor).toBe(ExchangeRateType.OFFICIAL);
    expect(notices).toEqual([
      {
        code: 'EXCHANGE_RATE_MARKET_FALLBACK',
        messageKey: 'currencies.market_rate_used_without_official',
        messageParams: { from: 'USD', to: 'PYG', date: DAY, source: 'XE', quotedOn: DAY },
      },
    ]);

    // An official quote answers for itself: nothing is substituted and nothing is said.
    await publish('USD', 'PYG', 59.5, DAY, ExchangeRateType.OFFICIAL, 'BCP');
    const official: RequestNotice[] = [];
    const direct = await collectNotices(official, () => resolver.resolve('USD', 'PYG', DAY, undefined, ExchangeRateType.OFFICIAL));
    expect(direct.substitutedFor).toBeUndefined();
    expect(official).toHaveLength(0);
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

  it('records a rate by hand with its source and its author, for the tenant that entered it', async () => {
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
      tenantA.id,
    );

    expect(result.rate.fromCurrency).toBe('USD');
    expect(result.rate.source).toBe('DGII');
    expect(result.rate.recordedByUserId).toBe(ACTOR);
    expect(result.rate.organizationId).toBe(tenantA.id);

    const resolved = await asTenant(tenantA.id, () => resolver.resolve('USD', 'PYG', DAY));
    expect(resolved.rate).toBeCloseTo(58.75, 6);
  });

  /**
   * A rate typed by one tenant used to land in the table every tenant converts with: one
   * customer's typo changed another customer's invoices. It is that tenant's alone now.
   */
  it('a rate one tenant records never converts another tenant\'s documents', async () => {
    await publish('USD', 'PYG', 58.8, DAY);
    await service.record({ fromCurrency: 'USD', toCurrency: 'PYG', rate: 1, date: DAY }, ACTOR, tenantA.id);

    const forA = await asTenant(tenantA.id, () => resolver.resolve('USD', 'PYG', DAY));
    const forB = await asTenant(tenantB.id, () => resolver.resolve('USD', 'PYG', DAY));
    const shared = await resolver.resolve('USD', 'PYG', DAY);

    expect(forA.rate).toBeCloseTo(1, 6);
    expect(forB.rate).toBeCloseTo(58.8, 6);
    expect(shared.rate).toBeCloseTo(58.8, 6);
  });

  it('the newest quote wins, whichever table it is in', async () => {
    await service.record({ fromCurrency: 'USD', toCurrency: 'PYG', rate: 50, date: '2026-03-10' }, ACTOR, tenantA.id);
    await publish('USD', 'PYG', 58.8, DAY);
    const resolved = await asTenant(tenantA.id, () => resolver.resolve('USD', 'PYG', DAY));
    expect(resolved.rate).toBeCloseTo(58.8, 6);
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
      tenantA.id,
    );
    await service.record(
      { fromCurrency: 'USD', toCurrency: 'PYG', rate: 58.8, date: DAY },
      ACTOR,
      tenantA.id,
    );

    const rows = await dataSource.getRepository(TenantExchangeRate).find({
      where: { organizationId: tenantA.id, fromCurrency: 'USD', toCurrency: 'PYG' },
    });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].rate)).toBeCloseTo(58.8, 6);
  });

  it('refuses a pair with the same currency on both sides', async () => {
    await expect(
      service.record({ fromCurrency: 'USD', toCurrency: 'USD', rate: 1, date: DAY }, ACTOR, tenantA.id),
    ).rejects.toThrow();
  });

  it('refuses a non-positive rate', async () => {
    await expect(
      service.record({ fromCurrency: 'USD', toCurrency: 'PYG', rate: 0, date: DAY }, ACTOR, tenantA.id),
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

  // ── The history, a month at once, and removing a typo ───────────────────────────────────────

  it('lists the company\'s own rates beside the shared ones, newest first, and never another company\'s', async () => {
    await publish('USD', 'PYG', 58.8, '2026-03-14');
    await service.record({ fromCurrency: 'USD', toCurrency: 'PYG', rate: 59, date: DAY }, ACTOR, tenantA.id);
    await service.record({ fromCurrency: 'USD', toCurrency: 'PYG', rate: 1, date: DAY }, ACTOR, tenantB.id);

    const page = await service.history(tenantA.id, { currency: 'pyg' });
    expect(page.items.map((row) => [row.scope, row.rate, row.date])).toEqual([
      ['TENANT', 59, DAY],
      ['SHARED', 58.8, '2026-03-14'],
    ]);
    const own = await service.history(tenantA.id, { currency: 'PYG', scope: RateScope.TENANT });
    expect(own.total).toBe(1);
  });

  it('imports a table of rates all or nothing, naming the row that is wrong', async () => {
    await expect(
      service.importRates(
        {
          rates: [
            { fromCurrency: 'USD', toCurrency: 'PYG', rate: 59, date: '2026-03-01' },
            { fromCurrency: 'USD', toCurrency: 'PYG', rate: 0, date: '2026-03-02' },
          ],
        },
        ACTOR,
        tenantA.id,
      ),
    ).rejects.toMatchObject({ messageKey: 'currencies.import_row_invalid', params: { row: 2 } });
    expect((await service.history(tenantA.id, { currency: 'PYG', scope: RateScope.TENANT })).total).toBe(0);

    const result = await service.importRates(
      {
        rates: [
          { fromCurrency: 'USD', toCurrency: 'PYG', rate: 59, date: '2026-03-01' },
          { fromCurrency: 'USD', toCurrency: 'PYG', rate: 59.5, date: '2026-03-02' },
        ],
      },
      ACTOR,
      tenantA.id,
    );
    expect(result.imported).toBe(2);
    expect((await service.history(tenantA.id, { currency: 'PYG', scope: RateScope.TENANT })).total).toBe(2);
  });

  it('removes a rate the company recorded, and only its own', async () => {
    const { rate } = await service.record({ fromCurrency: 'USD', toCurrency: 'PYG', rate: 59, date: DAY }, ACTOR, tenantA.id);
    await expect(service.remove(rate.id, tenantB.id)).rejects.toMatchObject({ messageKey: 'currencies.exchange_rate_not_found' });
    await service.remove(rate.id, tenantA.id);
    expect((await service.history(tenantA.id, { currency: 'PYG', scope: RateScope.TENANT })).total).toBe(0);
  });

  /**
   * Entering, correcting, importing and deleting a rate leave a row each, with the figure before and
   * after (FINB-05). All four wrote through `upsert` or a delete by criteria, which the audit
   * subscriber never sees, so none of them left any trace.
   */
  describe('the audit trail of a company\'s rates (FINB-05)', () => {
    beforeEach(markTrail);

    it('records the rate entered, the correction with the figure it replaced, and nothing for a repeat', async () => {
      const { rate } = await service.record({ fromCurrency: 'USD', toCurrency: 'PYG', rate: 59, date: DAY }, ACTOR, tenantA.id);
      await service.record({ fromCurrency: 'USD', toCurrency: 'PYG', rate: 59.25, date: DAY }, ACTOR, tenantA.id);
      // The same figure again changes nothing, so it records nothing.
      await service.record({ fromCurrency: 'USD', toCurrency: 'PYG', rate: 59.25, date: DAY }, ACTOR, tenantA.id);

      const rows = await trail(tenantA.id);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        action: 'CREATE',
        entityId: rate.id,
        userId: ACTOR,
        newValue: { fromCurrency: 'USD', toCurrency: 'PYG', date: DAY, rateType: 'OFFICIAL', rate: 59, source: 'MANUAL' },
      });
      expect(rows[0].previousValue).toBeNull();
      expect(rows[1]).toMatchObject({
        action: 'UPDATE',
        entityId: rate.id,
        newValue: { rate: 59.25 },
        previousValue: { rate: 59 },
      });
      // Each one in the transaction that wrote the rate; another company's trail has nothing of it.
      expect(rows.every((row) => row.inTransaction)).toBe(true);
      expect(await trail(tenantB.id)).toHaveLength(0);
    });

    it('an import leaves one row per rate it created or changed, and none for a rate it left as it was', async () => {
      await service.record({ fromCurrency: 'USD', toCurrency: 'PYG', rate: 59, date: '2026-03-01' }, ACTOR, tenantA.id);
      await service.record({ fromCurrency: 'USD', toCurrency: 'PYG', rate: 59.1, date: '2026-03-02' }, ACTOR, tenantA.id);
      await markTrail();

      await service.importRates(
        {
          rates: [
            { fromCurrency: 'USD', toCurrency: 'PYG', rate: 59, date: '2026-03-01' }, // unchanged
            { fromCurrency: 'USD', toCurrency: 'PYG', rate: 59.4, date: '2026-03-02' }, // corrected
            { fromCurrency: 'USD', toCurrency: 'PYG', rate: 59.6, date: '2026-03-03' }, // new
          ],
        },
        ACTOR,
        tenantA.id,
      );

      const rows = await trail(tenantA.id);
      expect(rows.map((row) => [row.action, row.newValue['date']]).sort()).toEqual([
        ['CREATE', '2026-03-03'],
        ['UPDATE', '2026-03-02'],
      ]);
      expect(rows.find((row) => row.action === 'UPDATE')).toMatchObject({
        newValue: { rate: 59.4 },
        previousValue: { rate: 59.1 },
      });
    });

    it('a refused import leaves no rate and no row', async () => {
      await expect(
        service.importRates(
          {
            rates: [
              { fromCurrency: 'USD', toCurrency: 'PYG', rate: 59, date: '2026-03-01' },
              { fromCurrency: 'USD', toCurrency: 'PYG', rate: -1, date: '2026-03-02' },
            ],
          },
          ACTOR,
          tenantA.id,
        ),
      ).rejects.toMatchObject({ messageKey: 'currencies.import_row_invalid' });
      expect(await trail(tenantA.id)).toHaveLength(0);
    });

    it('a deletion keeps the rate as it was, and who deleted it', async () => {
      const { rate } = await service.record({ fromCurrency: 'USD', toCurrency: 'PYG', rate: 59, date: DAY }, ACTOR, tenantA.id);
      const REMOVER = '66666666-6666-4666-8666-666666666666';
      await service.remove(rate.id, tenantA.id, REMOVER);

      const rows = await trail(tenantA.id);
      expect(rows.map((row) => row.action)).toEqual(['CREATE', 'DELETE']);
      expect(rows[1]).toMatchObject({ entityId: rate.id, userId: REMOVER, inTransaction: true, newValue: { rate: 59, date: DAY, fromCurrency: 'USD' } });
    });

    it('answers in the reader\'s language with the count it imported (FINB-04)', async () => {
      const result = await service.importRates(
        { rates: [{ fromCurrency: 'USD', toCurrency: 'PYG', rate: 59, date: '2026-03-05' }] },
        ACTOR,
        tenantA.id,
      );
      // The interceptor interpolates `messageParams`; the count next to the key was never read.
      expect(result).toMatchObject({ messageKey: 'currencies.exchange_rates_imported', messageParams: { imported: 1 } });
    });
  });

  it('explains a rate through the route the controller serves', async () => {
    await publish('USD', 'BOB', 6.9);
    await publish('USD', 'UYU', 40);

    const explained = await service.explain('BOB', 'UYU', DAY);
    expect(explained.method).toBe('TRIANGULATED');
    expect(explained.via).toBe('USD');
  });
});
