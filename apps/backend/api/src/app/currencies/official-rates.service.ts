import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DateTime } from 'luxon';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { addDaysIso, daysBetween } from '../common/dates';
import { roundAmount } from '../common/money';
import { ExternalEffect, externalEffectAllowed } from '../config/external-effects';
import { ChangeAuditPort } from '../contracts/audit/access-audit.contract';
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../i18n/localized.exception';
import { allMarkets, OfficialRateFormatError, OfficialRateQuote, RegisteredOfficialRateFeed } from '../markets';
import { ExclusiveJob } from '../shared/scheduling/exclusive-job';
import { ExchangeRateFeedState, ExchangeRateFeedStatus } from './entities/exchange-rate-feed.entity';
import {
  ExchangeRateFeedRun,
  ExchangeRateFeedRunStatus,
  FeedRunDiscrepancy,
  FeedRunQuote,
} from './entities/exchange-rate-feed-run.entity';
import { ExchangeRate, ExchangeRateType } from './entities/exchange-rate.entity';
import { OfficialRatesTransport } from './official-rates.transport';

/** The feeds this service reads: every market's (`OFFICIAL_RATE_FEEDS`), or a test's own. */
export const OFFICIAL_RATE_FEED_REGISTRY = Symbol('OFFICIAL_RATE_FEED_REGISTRY');
export type OfficialRateFeedRegistry = ReadonlyMap<string, RegisteredOfficialRateFeed>;

/** The days a first reading covers, and the widest range an operator may ask for. */
const FIRST_RUN_DAYS = 31;
const MAX_RANGE_DAYS = 370;
/** How far back each reading looks again, for a publisher's revision of a day already read. */
const CATCH_UP_DAYS = 5;
/** An active feed whose newest figure is older than this has stopped working. */
const STALE_AFTER_DAYS = 5;
/** Failed readings in a row after which the feed is reported as failing. */
const FAILING_AFTER = 3;

export type FeedTrigger = 'SCHEDULE' | 'OPERATOR';

export interface RunFeedOptions {
  trigger: FeedTrigger;
  actorUserId?: string | null;
  from?: string;
  to?: string;
  acceptJumps?: boolean;
  /** The present, for a test; the clock otherwise. */
  now?: Date;
}

/** A market's official rate as a company sees it: who publishes it, and whether it arrives on its own. */
export interface OfficialRateSourceView {
  country: string;
  publisher: string;
  quoteCurrency: string;
  legalBasis: string;
  feed: { code: string; publication: string; status: ExchangeRateFeedStatus; latestEffectiveOn: string | null } | null;
}

/** A feed as an operator sees it: what it reads, where it stands, and how it has been doing. */
export interface OfficialRateFeedView {
  code: string;
  country: string;
  publisher: string;
  publication: string;
  legalBasis: string;
  quoteCurrency: string;
  currencies: readonly string[];
  effectiveFrom: 'publication-day' | 'day-after-publication';
  publishedAfter: { timeZone: string; time: string };
  maxDailyChange: number | null;
  formatEstablishedFrom: 'documentation' | 'live-response';
  credentialRequired: boolean;
  credentialConfigured: boolean;
  status: ExchangeRateFeedStatus;
  statusChangedAt: Date | null;
  statusChangedBy: string | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
  /** The newest day this feed's figure is the official rate for, among the rates on file. */
  latestEffectiveOn: string | null;
  latestRun: ExchangeRateFeedRun | null;
}

/**
 * Official exchange rates, read from each market's publisher (audit 2026-11-07, FINB-03).
 *
 * The only automatic source was XE — a market quote, behind a platform account — so every
 * document in a foreign currency depended on somebody typing the day's official rate, and the
 * quote-age limit refused it ten days after they stopped. Each market now declares who publishes
 * its official rate and, where the product reads it, a feed (`markets/<cc>/accounting/`): where to
 * ask and how to read the answer. This service does the rest, the same for every market:
 *
 *  - **Whether to ask at all.** Reading a publisher is an external effect (`reference_data`): a
 *    development process or a CI run does not do it, and records the reading as skipped. A feed
 *    that needs a credential and has none is skipped too, naming the variable.
 *  - **Reading strictly.** A response the feed does not recognise fails the reading with the
 *    reason, and writes nothing; a figure is never guessed out of an answer that changed shape.
 *  - **Shadow first.** A feed starts in SHADOW: it reads and compares with the official rates on
 *    file, and writes nothing, until an operator — having seen it read the live publication
 *    correctly — activates it. Every feed's format was established from the publisher's
 *    documentation, so this is not a formality.
 *  - **Writing with provenance.** An active feed writes its figures to the shared table as
 *    `OFFICIAL`, under its own code as the source, for the day each is the official rate FOR
 *    (Mexico's contributions use the DOF of the day before). A day another source already holds
 *    is left as it is and reported if it differs; a publisher's revision of a day it wrote is
 *    applied and reported; a move beyond the feed's daily bound is reported and not written until
 *    an operator confirms it.
 *  - **A log of every reading**, written once when the reading ends: the figures, the counts, the
 *    discrepancies, and why it was skipped or failed.
 *  - **On schedule**, once the day's figure is out in the publisher's time zone, with a backoff
 *    after a failure; and an active feed that has stopped producing figures is reported.
 */
@Injectable()
export class OfficialRatesService {
  private readonly logger = new Logger(OfficialRatesService.name);

  constructor(
    @Inject(OFFICIAL_RATE_FEED_REGISTRY) private readonly registry: OfficialRateFeedRegistry,
    @InjectRepository(ExchangeRateFeedState) private readonly states: Repository<ExchangeRateFeedState>,
    @InjectRepository(ExchangeRateFeedRun) private readonly runs: Repository<ExchangeRateFeedRun>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly transport: OfficialRatesTransport,
    private readonly config: ConfigService,
    private readonly auditTrail: ChangeAuditPort,
  ) {}

  /** Every feed, with its state and its last reading. */
  async feeds(): Promise<OfficialRateFeedView[]> {
    const codes = [...this.registry.keys()].sort();
    // tenant-scope-guard-allow: `exchange_rate_feeds` is global — a feed's state is the deployment's, not a company's.
    const states = new Map((await this.states.find()).map((state) => [state.code, state]));
    return Promise.all(codes.map((code) => this.viewOf(code, states.get(code) ?? null)));
  }

  async feed(code: string): Promise<OfficialRateFeedView> {
    this.requireFeed(code);
    return this.viewOf(code, await this.states.findOneBy({ code }));
  }

  /**
   * Who publishes each market's official rate and whether it arrives on its own — what a company
   * reads to know where its official rates come from and whether it has to enter them. Public
   * reference data, the same for every company.
   */
  async sources(): Promise<OfficialRateSourceView[]> {
    // tenant-scope-guard-allow: `exchange_rate_feeds` is global — a feed's state is the deployment's, not a company's.
    const states = new Map((await this.states.find()).map((state) => [state.code, state]));
    return Promise.all(
      allMarkets()
        .filter((market) => market.accounting.officialExchangeRates)
        .map(async (market) => {
          const official = market.accounting.officialExchangeRates as NonNullable<typeof market.accounting.officialExchangeRates>;
          const registered = official.feed ? this.registry.get(official.feed.code) : undefined;
          return {
            country: market.code,
            publisher: official.publisher,
            quoteCurrency: official.quoteCurrency,
            legalBasis: official.legalBasis,
            feed: registered
              ? {
                  code: registered.feed.code,
                  publication: registered.feed.publication,
                  // Only an ACTIVE feed writes figures; a company of a market whose feed is still in
                  // shadow enters its rates as it did before.
                  status: states.get(registered.feed.code)?.status ?? ExchangeRateFeedStatus.SHADOW,
                  latestEffectiveOn: await this.latestEffectiveOn(registered),
                }
              : null,
          };
        }),
    );
  }

  /** A feed's readings, newest first. */
  async history(code: string, limit = 20): Promise<ExchangeRateFeedRun[]> {
    this.requireFeed(code);
    return this.runs.find({ where: { feedCode: code }, order: { startedAt: 'DESC' }, take: Math.min(Math.max(limit, 1), 100) });
  }

  /**
   * Decide where a feed stands: activate it once it has been seen reading the live publication
   * correctly, send it back to shadow, or switch it off. Recorded in the trail with who decided.
   */
  async setStatus(code: string, status: ExchangeRateFeedStatus, actorUserId: string | null): Promise<OfficialRateFeedView> {
    this.requireFeed(code);
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ExchangeRateFeedState);
      await repository.createQueryBuilder().insert().values({ code }).orIgnore().execute();
      const state = await repository.findOneOrFail({ where: { code }, lock: { mode: 'pessimistic_write' } });
      if (state.status === status) return;
      const before = { status: state.status };
      state.status = status;
      state.statusChangedAt = new Date();
      state.statusChangedBy = actorUserId;
      await repository.save(state);
      await this.auditTrail.recordChangesWithin(manager, [
        {
          userId: actorUserId,
          organizationId: null,
          entity: 'exchange_rate_feeds',
          entityId: code,
          action: 'UPDATE',
          before,
          after: { status },
        },
      ]);
    });
    return this.feed(code);
  }

  /** Read a feed now, and write or compare its figures as its state says. */
  async run(code: string, options: RunFeedOptions): Promise<ExchangeRateFeedRun | null> {
    const registered = this.requireFeed(code);
    const { feed } = registered;
    const state = await this.ensureState(code);
    if (state.status === ExchangeRateFeedStatus.DISABLED) {
      if (options.trigger === 'SCHEDULE') return null;
      throw new ConflictError('currencies.official_rates.feed_disabled', { feed: code });
    }
    const mode = state.status === ExchangeRateFeedStatus.ACTIVE ? 'ACTIVE' : 'SHADOW';
    const now = options.now ?? new Date();
    const today = this.todayFor(registered, now);
    const range = await this.rangeFor(registered, mode, today, options);
    const base = {
      feedCode: code,
      trigger: options.trigger,
      requestedBy: options.actorUserId ?? null,
      mode,
      rangeFrom: range.from,
      rangeTo: range.to,
      startedAt: now,
    } as const;

    if (!externalEffectAllowed(ExternalEffect.ReferenceData)) {
      return this.finish({ ...base, status: ExchangeRateFeedRunStatus.SKIPPED, reason: 'currencies.official_rates.reason.external_effects_disabled', detail: { effect: ExternalEffect.ReferenceData } });
    }
    const credential = feed.credentialEnv ? this.config.get<string>(feed.credentialEnv) || null : null;
    if (feed.credentialEnv && !credential) {
      return this.finish({ ...base, status: ExchangeRateFeedRunStatus.SKIPPED, reason: 'currencies.official_rates.reason.credential_missing', detail: { variable: feed.credentialEnv } });
    }

    let body: string;
    try {
      const request = feed.request(range, credential);
      const response = await this.transport.get(request.url, request.headers);
      if (response.status < 200 || response.status >= 300) {
        return this.finish({ ...base, status: ExchangeRateFeedRunStatus.FAILED, reason: 'currencies.official_rates.reason.publisher_refused', detail: { status: response.status } });
      }
      body = response.body;
    } catch (error) {
      // The code of a network failure (ECONNREFUSED, ETIMEDOUT), never the request: it may carry a credential.
      const failure = (error as { code?: string }).code ?? (error as Error).name ?? 'Error';
      return this.finish({ ...base, status: ExchangeRateFeedRunStatus.FAILED, reason: 'currencies.official_rates.reason.publisher_unreachable', detail: { error: failure } });
    }

    let quotes: OfficialRateQuote[];
    try {
      quotes = feed.parse(body);
    } catch (error) {
      if (!(error instanceof OfficialRateFormatError)) throw error;
      return this.finish({ ...base, status: ExchangeRateFeedRunStatus.FAILED, reason: 'currencies.official_rates.reason.publication_unrecognised', detail: { reason: error.reason } });
    }

    const readings: FeedRunQuote[] = quotes
      .filter((quote) => feed.currencies.includes(quote.currency) && quote.publishedOn >= range.from && quote.publishedOn <= range.to)
      .map((quote) => ({
        currency: quote.currency,
        publishedOn: quote.publishedOn,
        effectiveOn: feed.effectiveFrom === 'day-after-publication' ? addDaysIso(quote.publishedOn, 1) : quote.publishedOn,
        rate: roundAmount(quote.rate, 6),
      }));

    return this.dataSource.transaction(async (manager) => {
      // One reading of a feed at a time: the scheduled one and an operator's cannot interleave.
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`official-rates:${code}`]);
      const outcome = await this.reconcile(manager, registered, readings, mode, options.acceptJumps ?? false);
      return this.finish({ ...base, status: ExchangeRateFeedRunStatus.SUCCEEDED, reason: null, detail: null, quotes: readings, ...outcome }, manager);
    });
  }

  /**
   * Every feed whose day's figure is due, read on schedule; then report any active feed that has
   * stopped producing figures. One replica at a time.
   */
  @Cron('*/30 * * * *')
  @ExclusiveJob('official-rate-feeds')
  async sweep(): Promise<void> {
    const now = new Date();
    for (const code of [...this.registry.keys()].sort()) {
      try {
        const state = await this.states.findOneBy({ code });
        if (state?.status === ExchangeRateFeedStatus.DISABLED || !this.isDue(this.requireFeed(code), state, now)) continue;
        await this.run(code, { trigger: 'SCHEDULE', now });
      } catch (error) {
        // A cron handler that throws takes the process down with it; one feed's failure must not
        // stop the others either.
        this.logger.error({ event: 'official_rate_feed_sweep_failed', feed: code, error: (error as Error).message });
      }
    }
    await this.reportStale(now);
  }

  // ── Reading ───────────────────────────────────────────────────────────────────────────────────

  /** Compare, and in ACTIVE write, a reading's figures against the official rates on file. */
  private async reconcile(
    manager: EntityManager,
    { feed, quoteCurrency }: RegisteredOfficialRateFeed,
    readings: FeedRunQuote[],
    mode: 'SHADOW' | 'ACTIVE',
    acceptJumps: boolean,
  ): Promise<{ written: number; unchanged: number; discrepancies: FeedRunDiscrepancy[] }> {
    let written = 0;
    let unchanged = 0;
    const discrepancies: FeedRunDiscrepancy[] = [];
    const rates = manager.getRepository(ExchangeRate);
    const same = (a: number, b: number) => roundAmount(a, 6) === roundAmount(b, 6);

    for (const reading of [...readings].sort((a, b) => a.effectiveOn.localeCompare(b.effectiveOn))) {
      const key = { fromCurrency: reading.currency, toCurrency: quoteCurrency, rateType: ExchangeRateType.OFFICIAL };
      const onFile = await rates.findOne({ where: { ...key, date: reading.effectiveOn as unknown as Date } });
      const report = (kind: FeedRunDiscrepancy['kind'], figure: number | null, source: string | null) =>
        discrepancies.push({ kind, currency: reading.currency, effectiveOn: reading.effectiveOn, published: reading.rate, onFile: figure, onFileSource: source });

      if (mode === 'SHADOW') {
        if (onFile && !same(Number(onFile.rate), reading.rate)) report('differs', Number(onFile.rate), onFile.source);
        continue;
      }
      if (onFile) {
        if (onFile.source !== feed.code) {
          // Another source holds the day — a rate the platform entered, say. It is not overwritten.
          if (same(Number(onFile.rate), reading.rate)) unchanged++;
          else report('held_by_other_source', Number(onFile.rate), onFile.source);
          continue;
        }
        if (same(Number(onFile.rate), reading.rate)) {
          unchanged++;
          continue;
        }
        // The publisher revised a day this feed wrote: the revision is the official figure.
        await rates.update({ id: onFile.id }, { rate: reading.rate });
        report('revised', Number(onFile.rate), onFile.source);
        written++;
        continue;
      }
      if (feed.maxDailyChange !== null && !acceptJumps) {
        const previous = await rates
          // tenant-scope-guard-allow: `exchange_rate` is the shared table of published rates, global by design.
          .createQueryBuilder('rate')
          .where('rate."fromCurrency" = :from AND rate."toCurrency" = :to AND rate.rate_type = :type AND rate.date < :day', {
            from: reading.currency,
            to: quoteCurrency,
            type: ExchangeRateType.OFFICIAL,
            day: reading.effectiveOn,
          })
          .orderBy('rate.date', 'DESC')
          .getOne();
        if (previous && Math.abs(reading.rate / Number(previous.rate) - 1) > feed.maxDailyChange) {
          report('jump', Number(previous.rate), previous.source);
          continue;
        }
      }
      await rates
        // tenant-scope-guard-allow: `exchange_rate` and `exchange_rate_feeds` are global (published rates, feed state).
        .createQueryBuilder()
        .insert()
        .values({ ...key, rate: reading.rate, date: reading.effectiveOn as unknown as Date, source: feed.code, recordedByUserId: null })
        .orIgnore()
        .execute();
      written++;
    }
    return { written, unchanged, discrepancies };
  }

  /** The reading's log row, and the feed's state after it. */
  private async finish(
    run: Omit<Partial<ExchangeRateFeedRun>, 'id'> & Pick<ExchangeRateFeedRun, 'feedCode' | 'status' | 'startedAt'>,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<ExchangeRateFeedRun> {
    const finishedAt = new Date();
    const saved = await manager.getRepository(ExchangeRateFeedRun).save(
      manager.getRepository(ExchangeRateFeedRun).create({ quotes: [], written: 0, unchanged: 0, discrepancies: [], reason: null, detail: null, ...run, finishedAt }),
    );
    const failed = run.status === ExchangeRateFeedRunStatus.FAILED;
    await manager
      // tenant-scope-guard-allow: `exchange_rate` and `exchange_rate_feeds` are global (published rates, feed state).
      .createQueryBuilder()
      .update(ExchangeRateFeedState)
      .set({
        lastRunAt: finishedAt,
        ...(run.status === ExchangeRateFeedRunStatus.SUCCEEDED ? { lastSuccessAt: finishedAt, consecutiveFailures: 0 } : {}),
        ...(failed ? { consecutiveFailures: () => 'consecutive_failures + 1' } : {}),
      })
      .where('code = :code', { code: run.feedCode })
      .execute();
    if (failed) {
      const state = await manager.getRepository(ExchangeRateFeedState).findOneBy({ code: run.feedCode });
      if (state && state.consecutiveFailures >= FAILING_AFTER) {
        this.logger.error({ event: 'official_rate_feed_failing', feed: run.feedCode, failures: state.consecutiveFailures, reason: run.reason, detail: run.detail });
      }
    }
    return saved;
  }

  // ── When, and which days ──────────────────────────────────────────────────────────────────────

  /** Due once the day's figure is out where the publisher is, or again after a failure's backoff. */
  private isDue(registered: RegisteredOfficialRateFeed, state: ExchangeRateFeedState | null, now: Date): boolean {
    if (!state?.lastRunAt) return true;
    const { timeZone, time } = registered.feed.publishedAfter;
    const [hour, minute] = time.split(':').map(Number);
    const local = DateTime.fromJSDate(now, { zone: timeZone });
    const todays = local.set({ hour, minute, second: 0, millisecond: 0 });
    const latestPublication = local >= todays ? todays : todays.minus({ days: 1 });
    if (state.lastRunAt < latestPublication.toJSDate()) return true;
    if (state.consecutiveFailures === 0) return false;
    const backoffMinutes = Math.min(30 * 2 ** (state.consecutiveFailures - 1), 6 * 60);
    return now.getTime() - state.lastRunAt.getTime() >= backoffMinutes * 60_000;
  }

  /** Today where the publisher is. */
  private todayFor({ feed }: RegisteredOfficialRateFeed, now: Date): string {
    return DateTime.fromJSDate(now, { zone: feed.publishedAfter.timeZone }).toISODate() as string;
  }

  /**
   * The publication days to read: what the operator asked for, within bounds; otherwise from a few
   * days before the newest figure on file (or the last reading, in shadow) to as far ahead as the
   * publication dates its figures.
   */
  private async rangeFor(
    registered: RegisteredOfficialRateFeed,
    mode: 'SHADOW' | 'ACTIVE',
    today: string,
    options: RunFeedOptions,
  ): Promise<{ from: string; to: string }> {
    const horizon = addDaysIso(today, registered.feed.datesAhead);
    if (options.from || options.to) {
      const to = options.to ?? horizon;
      const from = options.from ?? addDaysIso(to, -FIRST_RUN_DAYS);
      if (from > to) throw new UnprocessableEntityError('currencies.official_rates.range_inverted', { from, to });
      if (to > horizon) throw new UnprocessableEntityError('currencies.official_rates.range_in_future', { to, horizon });
      if (daysBetween(from, to) > MAX_RANGE_DAYS) {
        throw new UnprocessableEntityError('currencies.official_rates.range_too_wide', { days: daysBetween(from, to), max: MAX_RANGE_DAYS });
      }
      return { from, to };
    }
    const anchor =
      mode === 'ACTIVE'
        ? await this.latestEffectiveOn(registered)
        : ((await this.runs.findOne({
            where: { feedCode: registered.feed.code, status: ExchangeRateFeedRunStatus.SUCCEEDED },
            order: { startedAt: 'DESC' },
          }))?.rangeTo ?? null);
    const earliest = addDaysIso(today, -MAX_RANGE_DAYS);
    const from = anchor ? [addDaysIso(anchor, -CATCH_UP_DAYS), earliest].sort()[1] : addDaysIso(today, -FIRST_RUN_DAYS);
    return { from: from > horizon ? horizon : from, to: horizon };
  }

  // ── State and views ───────────────────────────────────────────────────────────────────────────

  private requireFeed(code: string): RegisteredOfficialRateFeed {
    const registered = this.registry.get(code);
    if (!registered) throw new NotFoundError('currencies.official_rates.feed_not_found', { feed: code });
    return registered;
  }

  /** The feed's state row, created in SHADOW the first time it is read. */
  private async ensureState(code: string): Promise<ExchangeRateFeedState> {
    // tenant-scope-guard-allow: `exchange_rate_feeds` is global — a feed's state is the deployment's, not a company's.
    await this.states.createQueryBuilder().insert().values({ code }).orIgnore().execute();
    return this.states.findOneByOrFail({ code });
  }

  private async latestEffectiveOn({ feed, quoteCurrency }: RegisteredOfficialRateFeed): Promise<string | null> {
    const [row] = await this.dataSource.query(
      `SELECT to_char(MAX(date), 'YYYY-MM-DD') AS latest FROM exchange_rate
        WHERE source = $1 AND "toCurrency" = $2 AND rate_type = 'OFFICIAL'`,
      [feed.code, quoteCurrency],
    );
    return row?.latest ?? null;
  }

  private async viewOf(code: string, state: ExchangeRateFeedState | null): Promise<OfficialRateFeedView> {
    const registered = this.requireFeed(code);
    const { feed } = registered;
    const [latestRun] = await this.runs.find({ where: { feedCode: code }, order: { startedAt: 'DESC' }, take: 1 });
    return {
      code,
      country: feed.country,
      publisher: registered.publisher,
      publication: feed.publication,
      legalBasis: registered.legalBasis,
      quoteCurrency: registered.quoteCurrency,
      currencies: feed.currencies,
      effectiveFrom: feed.effectiveFrom,
      publishedAfter: { ...feed.publishedAfter },
      maxDailyChange: feed.maxDailyChange,
      formatEstablishedFrom: feed.formatEstablishedFrom,
      credentialRequired: Boolean(feed.credentialEnv),
      credentialConfigured: Boolean(feed.credentialEnv && this.config.get<string>(feed.credentialEnv)),
      status: state?.status ?? ExchangeRateFeedStatus.SHADOW,
      statusChangedAt: state?.statusChangedAt ?? null,
      statusChangedBy: state?.statusChangedBy ?? null,
      lastRunAt: state?.lastRunAt ?? null,
      lastSuccessAt: state?.lastSuccessAt ?? null,
      consecutiveFailures: state?.consecutiveFailures ?? 0,
      latestEffectiveOn: await this.latestEffectiveOn(registered),
      latestRun: latestRun ?? null,
    };
  }

  /** An ACTIVE feed whose newest figure is older than it should be has stopped working: say so. */
  private async reportStale(now: Date): Promise<void> {
    const active = await this.states.findBy({ status: ExchangeRateFeedStatus.ACTIVE });
    for (const state of active) {
      const registered = this.registry.get(state.code);
      if (!registered) continue;
      const latest = await this.latestEffectiveOn(registered);
      const today = this.todayFor(registered, now);
      if (!latest || daysBetween(latest, today) > STALE_AFTER_DAYS) {
        this.logger.error({ event: 'official_rate_feed_stale', feed: state.code, latestEffectiveOn: latest, today });
      }
    }
  }
}
