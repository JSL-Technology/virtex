import { DataSource } from 'typeorm';
import { OfficialRateFeed, OfficialRateFormatError, RegisteredOfficialRateFeed } from '../markets';
import { ChangeAuditPort, TransactionalChange } from '../contracts/audit/access-audit.contract';
import { describeWithDb, openTestDataSource } from '../common/database/testing/integration-db';
import { ExchangeRateFeedState, ExchangeRateFeedStatus } from './entities/exchange-rate-feed.entity';
import { ExchangeRateFeedRun } from './entities/exchange-rate-feed-run.entity';
import { ExchangeRateType } from './entities/exchange-rate.entity';
import { testExchangeRateResolver } from './exchange-rate-resolver.testing';
import { OfficialRatesService, OfficialRateFeedRegistry } from './official-rates.service';
import { OfficialRatesTransport, PublisherResponse } from './official-rates.transport';

/**
 * Official rates read from each market's publisher (FINB-03), against PostgreSQL.
 *
 * The feeds here are the suite's own — codes and currencies (`R1X`, `R2X` quoted in `R1Q`; a digit
 * is never an ISO 4217 code) that no market declares and no other suite reads — because the rate
 * table and the feeds' state are global. The publisher is a recorded document; the network is never
 * reached.
 */
describeWithDb('official rates from the publisher (FINB-03)', () => {
  jest.setTimeout(120_000);

  let ds: DataSource;
  let service: OfficialRatesService;
  let respond: (url: string) => Promise<PublisherResponse>;
  const transport = { get: jest.fn((url: string) => respond(url)) } as unknown as OfficialRatesTransport;
  const env: Record<string, string | undefined> = {};
  const audited: TransactionalChange[] = [];
  const NOW = new Date('2026-03-20T22:00:00Z'); // after the 18:00 publication in Bogotá's zone

  /** A publication: `[{ day, rate }]`, and nothing else. */
  const document = (rows: Array<{ day: string; rate: number | string; currency?: string }>) =>
    JSON.stringify(rows.map((row) => ({ currency: 'R1X', ...row })));
  const testFeed = (code: string, overrides: Partial<OfficialRateFeed> = {}): RegisteredOfficialRateFeed => ({
    publisher: 'Banco QA',
    legalBasis: 'Prueba',
    quoteCurrency: 'R1Q',
    feed: {
      code,
      country: 'ZZ',
      publication: 'Tasa QA',
      currencies: ['R1X', 'R2X'],
      effectiveFrom: 'publication-day',
      publishedAfter: { timeZone: 'America/Bogota', time: '18:00' },
      datesAhead: 1,
      maxDailyChange: 0.1,
      credentialEnv: null,
      formatEstablishedFrom: 'documentation',
      request: ({ from, to }, credential) => {
        const headers: Record<string, string> = credential ? { Token: credential } : {};
        return { url: `https://publisher.test/${code}?from=${from}&to=${to}`, headers };
      },
      parse: (body) => {
        let rows: unknown;
        try {
          rows = JSON.parse(body);
        } catch {
          throw new OfficialRateFormatError(code, 'the response is not JSON');
        }
        if (!Array.isArray(rows)) throw new OfficialRateFormatError(code, 'the response is not a list');
        return rows.map((row: { day: string; rate: number; currency: string }) => ({ currency: row.currency, publishedOn: row.day, rate: Number(row.rate) }));
      },
      ...overrides,
    },
  });
  const FEED = 'QA-FEED-DAY';
  const NEXT_DAY_FEED = 'QA-FEED-NEXT';
  const registry: OfficialRateFeedRegistry = new Map([
    [FEED, testFeed(FEED)],
    [NEXT_DAY_FEED, testFeed(NEXT_DAY_FEED, { effectiveFrom: 'day-after-publication', credentialEnv: 'QA_FEED_TOKEN', maxDailyChange: null, currencies: ['R2X'] })],
  ]);

  const officialOnFile = async (currency: string, day: string) =>
    (
      await ds.query(
        `SELECT rate::float AS rate, source FROM exchange_rate WHERE "fromCurrency" = $1 AND "toCurrency" = 'R1Q' AND date = $2 AND rate_type = 'OFFICIAL'`,
        [currency, day],
      )
    )[0] as { rate: number; source: string } | undefined;

  const cleanUp = async () => {
    await ds.query(`DELETE FROM exchange_rate WHERE "toCurrency" = 'R1Q'`);
    await ds.query(`DELETE FROM exchange_rate_feed_runs WHERE feed_code IN ($1, $2)`, [FEED, NEXT_DAY_FEED]);
    await ds.query(`DELETE FROM exchange_rate_feeds WHERE code IN ($1, $2)`, [FEED, NEXT_DAY_FEED]);
  };

  const previousEffects = process.env['EXTERNAL_EFFECTS'];

  beforeAll(async () => {
    ds = await openTestDataSource();
    const audit = {
      recordChange: async () => undefined,
      actorsOf: async () => [],
      recordChangesWithin: async (_manager, changes) => {
        audited.push(...changes);
      },
    } satisfies ChangeAuditPort;
    service = new OfficialRatesService(
      registry,
      ds.getRepository(ExchangeRateFeedState),
      ds.getRepository(ExchangeRateFeedRun),
      ds,
      transport,
      { get: (key: string) => env[key] } as never,
      audit,
    );
  });

  beforeEach(async () => {
    await cleanUp();
    process.env['EXTERNAL_EFFECTS'] = 'reference_data';
    delete env['QA_FEED_TOKEN'];
    audited.length = 0;
    (transport.get as jest.Mock).mockClear();
  });

  afterAll(async () => {
    if (previousEffects === undefined) delete process.env['EXTERNAL_EFFECTS'];
    else process.env['EXTERNAL_EFFECTS'] = previousEffects;
    if (ds?.isInitialized) {
      await cleanUp();
      await ds.destroy();
    }
  });

  it('does not reach the publisher from a process whose external effects exclude reference data, and says why', async () => {
    process.env['EXTERNAL_EFFECTS'] = 'none';
    const run = await service.run(FEED, { trigger: 'SCHEDULE', now: NOW });
    expect(transport.get).not.toHaveBeenCalled();
    expect(run).toMatchObject({
      status: 'SKIPPED',
      reason: 'currencies.official_rates.reason.external_effects_disabled',
      detail: { effect: 'reference_data' },
      mode: 'SHADOW',
    });
    // A new feed starts in shadow, and its state says it ran.
    expect(await service.feed(FEED)).toMatchObject({ status: ExchangeRateFeedStatus.SHADOW, consecutiveFailures: 0, lastRunAt: expect.any(Date) });
  });

  it('skips a feed whose credential is not configured, naming the variable', async () => {
    const run = await service.run(NEXT_DAY_FEED, { trigger: 'OPERATOR', now: NOW });
    expect(transport.get).not.toHaveBeenCalled();
    expect(run).toMatchObject({ status: 'SKIPPED', reason: 'currencies.official_rates.reason.credential_missing', detail: { variable: 'QA_FEED_TOKEN' } });
  });

  it('in shadow it reads and compares, and writes nothing', async () => {
    await ds.query(
      `INSERT INTO exchange_rate ("fromCurrency", "toCurrency", rate, date, rate_type, source) VALUES ('R1X', 'R1Q', 99, '2026-03-18', 'OFFICIAL', 'MANUAL')`,
    );
    respond = async () => ({ status: 200, body: document([{ day: '2026-03-18', rate: 100 }, { day: '2026-03-19', rate: 101 }]) });

    const run = await service.run(FEED, { trigger: 'SCHEDULE', now: NOW });

    // The first reading covers a month back, and the day ahead the publication may already date.
    expect(run).toMatchObject({ status: 'SUCCEEDED', mode: 'SHADOW', rangeFrom: '2026-02-17', rangeTo: '2026-03-21', written: 0 });
    expect(run!.quotes).toEqual([
      { currency: 'R1X', publishedOn: '2026-03-18', effectiveOn: '2026-03-18', rate: 100 },
      { currency: 'R1X', publishedOn: '2026-03-19', effectiveOn: '2026-03-19', rate: 101 },
    ]);
    expect(run!.discrepancies).toEqual([
      { kind: 'differs', currency: 'R1X', effectiveOn: '2026-03-18', published: 100, onFile: 99, onFileSource: 'MANUAL' },
    ]);
    expect(await officialOnFile('R1X', '2026-03-19')).toBeUndefined();
  });

  it('activated by an operator, it writes the official rate under its own code, and the trail says who', async () => {
    await service.setStatus(FEED, ExchangeRateFeedStatus.ACTIVE, '77777777-7777-4777-8777-777777777777');
    expect(audited).toEqual([
      expect.objectContaining({ entity: 'exchange_rate_feeds', entityId: FEED, action: 'UPDATE', before: { status: 'SHADOW' }, after: { status: 'ACTIVE' }, organizationId: null }),
    ]);

    respond = async () => ({ status: 200, body: document([{ day: '2026-03-18', rate: 100 }, { day: '2026-03-19', rate: 101.5 }]) });
    const run = await service.run(FEED, { trigger: 'SCHEDULE', now: NOW });
    expect(run).toMatchObject({ status: 'SUCCEEDED', mode: 'ACTIVE', written: 2, unchanged: 0, discrepancies: [] });
    expect(await officialOnFile('R1X', '2026-03-19')).toEqual({ rate: 101.5, source: FEED });

    // What a company converts with: the resolver answers with the feed's figure and names it.
    const resolved = await testExchangeRateResolver(ds).resolve('R1X', 'R1Q', '2026-03-19', undefined, ExchangeRateType.OFFICIAL);
    expect(resolved).toMatchObject({ rate: 101.5, source: FEED, rateType: 'OFFICIAL', method: 'DIRECT' });

    // Read again: nothing changes; the range starts a few days before the newest figure on file.
    const again = await service.run(FEED, { trigger: 'SCHEDULE', now: NOW });
    expect(again).toMatchObject({ written: 0, unchanged: 2, rangeFrom: '2026-03-14' });
  });

  it('applies a publisher\'s revision, and leaves alone a day another source holds', async () => {
    await service.setStatus(FEED, ExchangeRateFeedStatus.ACTIVE, null);
    respond = async () => ({ status: 200, body: document([{ day: '2026-03-18', rate: 100 }]) });
    await service.run(FEED, { trigger: 'OPERATOR', now: NOW });
    await ds.query(
      `INSERT INTO exchange_rate ("fromCurrency", "toCurrency", rate, date, rate_type, source) VALUES ('R1X', 'R1Q', 95, '2026-03-17', 'OFFICIAL', 'MANUAL')`,
    );

    respond = async () => ({ status: 200, body: document([{ day: '2026-03-17', rate: 99.5 }, { day: '2026-03-18', rate: 100.2 }]) });
    const run = await service.run(FEED, { trigger: 'OPERATOR', now: NOW });

    expect(run!.discrepancies).toEqual([
      { kind: 'held_by_other_source', currency: 'R1X', effectiveOn: '2026-03-17', published: 99.5, onFile: 95, onFileSource: 'MANUAL' },
      { kind: 'revised', currency: 'R1X', effectiveOn: '2026-03-18', published: 100.2, onFile: 100, onFileSource: FEED },
    ]);
    expect(await officialOnFile('R1X', '2026-03-17')).toEqual({ rate: 95, source: 'MANUAL' });
    expect(await officialOnFile('R1X', '2026-03-18')).toEqual({ rate: 100.2, source: FEED });
  });

  it('does not write a move beyond the feed\'s daily bound until an operator confirms it', async () => {
    await service.setStatus(FEED, ExchangeRateFeedStatus.ACTIVE, null);
    respond = async () => ({ status: 200, body: document([{ day: '2026-03-18', rate: 100 }, { day: '2026-03-19', rate: 150 }]) });

    const run = await service.run(FEED, { trigger: 'OPERATOR', now: NOW });
    expect(run).toMatchObject({ written: 1 });
    expect(run!.discrepancies).toEqual([{ kind: 'jump', currency: 'R1X', effectiveOn: '2026-03-19', published: 150, onFile: 100, onFileSource: FEED }]);
    expect(await officialOnFile('R1X', '2026-03-19')).toBeUndefined();

    const confirmed = await service.run(FEED, { trigger: 'OPERATOR', now: NOW, acceptJumps: true });
    expect(confirmed).toMatchObject({ written: 1, discrepancies: [] });
    expect(await officialOnFile('R1X', '2026-03-19')).toEqual({ rate: 150, source: FEED });
  });

  it('stores a figure on the day it is the official rate for — the day after it is published, where that is the rule', async () => {
    env['QA_FEED_TOKEN'] = 'secret-token';
    await service.setStatus(NEXT_DAY_FEED, ExchangeRateFeedStatus.ACTIVE, null);
    respond = async (url) => {
      expect(url).toContain('/QA-FEED-NEXT?from=');
      return { status: 200, body: document([{ day: '2026-03-13', rate: 17.9, currency: 'R2X' }]) };
    };
    const run = await service.run(NEXT_DAY_FEED, { trigger: 'OPERATOR', now: NOW });
    expect(run!.quotes).toEqual([{ currency: 'R2X', publishedOn: '2026-03-13', effectiveOn: '2026-03-14', rate: 17.9 }]);
    expect((transport.get as jest.Mock).mock.calls[0][1]).toEqual({ Token: 'secret-token' });
    expect(await ds.query(`SELECT to_char(date, 'YYYY-MM-DD') AS day FROM exchange_rate WHERE "fromCurrency" = 'R2X' AND "toCurrency" = 'R1Q'`)).toEqual([
      { day: '2026-03-14' },
    ]);
  });

  it('fails a reading it cannot complete, writes nothing, and counts the failures in a row', async () => {
    await service.setStatus(FEED, ExchangeRateFeedStatus.ACTIVE, null);

    respond = async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    };
    expect(await service.run(FEED, { trigger: 'SCHEDULE', now: NOW })).toMatchObject({
      status: 'FAILED',
      reason: 'currencies.official_rates.reason.publisher_unreachable',
      detail: { error: 'ECONNREFUSED' },
    });

    respond = async () => ({ status: 503, body: 'Service Unavailable' });
    expect(await service.run(FEED, { trigger: 'SCHEDULE', now: NOW })).toMatchObject({ status: 'FAILED', reason: 'currencies.official_rates.reason.publisher_refused', detail: { status: 503 } });

    respond = async () => ({ status: 200, body: '<html>Mantenimiento</html>' });
    expect(await service.run(FEED, { trigger: 'SCHEDULE', now: NOW })).toMatchObject({
      status: 'FAILED',
      reason: 'currencies.official_rates.reason.publication_unrecognised',
      detail: { reason: 'the response is not JSON' },
    });
    expect(await service.feed(FEED)).toMatchObject({ consecutiveFailures: 3, lastSuccessAt: null });
    expect(await ds.query(`SELECT COUNT(*)::int AS count FROM exchange_rate WHERE "toCurrency" = 'R1Q'`)).toEqual([{ count: 0 }]);

    // A reading that succeeds clears the count.
    respond = async () => ({ status: 200, body: document([]) });
    await service.run(FEED, { trigger: 'SCHEDULE', now: NOW });
    expect(await service.feed(FEED)).toMatchObject({ consecutiveFailures: 0, lastSuccessAt: expect.any(Date) });
  });

  it('a switched-off feed is not read on schedule, and an operator is told so', async () => {
    await service.setStatus(FEED, ExchangeRateFeedStatus.DISABLED, null);
    expect(await service.run(FEED, { trigger: 'SCHEDULE', now: NOW })).toBeNull();
    await expect(service.run(FEED, { trigger: 'OPERATOR', now: NOW })).rejects.toMatchObject({ messageKey: 'currencies.official_rates.feed_disabled' });
    expect(transport.get).not.toHaveBeenCalled();
  });

  it('reads the range an operator asks for, within bounds', async () => {
    respond = async () => ({ status: 200, body: document([]) });
    expect(await service.run(FEED, { trigger: 'OPERATOR', now: NOW, from: '2026-01-01', to: '2026-01-31' })).toMatchObject({ rangeFrom: '2026-01-01', rangeTo: '2026-01-31' });
    await expect(service.run(FEED, { trigger: 'OPERATOR', now: NOW, from: '2026-02-01', to: '2026-01-01' })).rejects.toMatchObject({
      messageKey: 'currencies.official_rates.range_inverted',
    });
    await expect(service.run(FEED, { trigger: 'OPERATOR', now: NOW, to: '2026-03-30' })).rejects.toMatchObject({
      messageKey: 'currencies.official_rates.range_in_future',
      params: { horizon: '2026-03-21' },
    });
    await expect(service.run(FEED, { trigger: 'OPERATOR', now: NOW, from: '2024-01-01', to: '2026-01-01' })).rejects.toMatchObject({
      messageKey: 'currencies.official_rates.range_too_wide',
    });
    await expect(service.run('NO-SUCH-FEED', { trigger: 'OPERATOR' })).rejects.toMatchObject({ messageKey: 'currencies.official_rates.feed_not_found' });
  });

  it('is due once the day\'s figure is out where the publisher is, and again after a failure\'s backoff', () => {
    const isDue = (lastRunAt: string | null, now: string, consecutiveFailures = 0) =>
      (service as unknown as { isDue: (...args: unknown[]) => boolean }).isDue(
        registry.get(FEED),
        lastRunAt ? { lastRunAt: new Date(lastRunAt), consecutiveFailures } : null,
        new Date(now),
      );
    // 18:00 in Bogotá is 23:00 UTC.
    expect(isDue(null, '2026-03-20T12:00:00Z')).toBe(true); // never read
    expect(isDue('2026-03-19T23:30:00Z', '2026-03-20T22:00:00Z')).toBe(false); // read after yesterday's, today's not out
    expect(isDue('2026-03-19T23:30:00Z', '2026-03-20T23:05:00Z')).toBe(true); // today's is out
    expect(isDue('2026-03-20T23:10:00Z', '2026-03-20T23:20:00Z', 1)).toBe(false); // failed 10 minutes ago: backoff 30
    expect(isDue('2026-03-20T23:10:00Z', '2026-03-20T23:41:00Z', 1)).toBe(true);
    expect(isDue('2026-03-20T23:10:00Z', '2026-03-21T03:00:00Z', 5)).toBe(false); // backoff 6 h after five
  });

  it('tells a company who publishes its market\'s official rate and whether it arrives on its own', async () => {
    const sources = await service.sources();
    const colombia = sources.find((source) => source.country === 'CO');
    expect(colombia).toMatchObject({ publisher: 'Superintendencia Financiera de Colombia', quoteCurrency: 'COP' });
    // Colombia's feed is not in this suite's registry: a market whose feed is not served has none.
    expect(colombia?.feed).toBeNull();
    expect(sources.find((source) => source.country === 'DO')).toMatchObject({ publisher: 'Banco Central de la República Dominicana', feed: null });
    expect(sources.some((source) => source.country === 'US')).toBe(false);
  });
});
