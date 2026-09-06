import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';
import { BadRequestError } from '../i18n/localized.exception';
import { roundAmount } from '../common/money';

/** One quote, as the provider published it. */
export interface XeQuote {
  currency: string;
  /** Units of `currency` for one unit of the base the request asked from. */
  rate: number;
}

export interface XeAccountInfo {
  /** The plan name XE reports, e.g. `Freetrial Daily` or `Prime`. */
  package: string;
  /** Requests left in the current window, when XE reports it. */
  remaining: number | null;
  /**
   * True when the account is on the free trial.
   *
   * XE serves **mock rates** on the free trial — its own dashboard says so. A mock rate stored in
   * `exchange_rates` is indistinguishable from a real one afterwards, and every foreign-currency
   * invoice, revaluation and exchange difference computed from it is a fabricated number sitting in
   * a book that a tax authority reads. This flag is what lets the refresh refuse to persist them.
   */
  servesMockRates: boolean;
}

/**
 * The XE Currency Data API, in one place.
 *
 * ## Why the HTTP contract is its own class
 *
 * `ExchangeRatesService` decides what to persist and when; this decides what XE actually said. The
 * two used to be one method, which meant the response shape could not be tested without a
 * repository, a scheduler lock and a Nest module — so it never was, and it was wrong in two ways
 * that only a live call would reveal.
 *
 * ## What was wrong
 *
 * 1. **The endpoint does not exist.** The client called `/v1/rates/historical.json`. The XE
 *    Currency Data API publishes `/v1/account_info`, `/v1/currencies`, `/v1/convert_from`,
 *    `/v1/convert_to`, `/v1/historic_rate`, `/v1/historic_rate/period` and `/v1/monthly_average`.
 *    A dated quote comes from `historic_rate`; there is no `rates/historical`. Every scheduled
 *    refresh answered 404, was caught, logged and swallowed, and the table stayed empty — which
 *    reads, from inside the product, exactly like "this tenant has not set up rates yet".
 * 2. **The response shape was guessed.** XE returns `to` as an ARRAY of
 *    `{ quotecurrency, mid }` objects. The parser did `Object.entries(payload.to)` expecting a map
 *    of code → number, so even against a working endpoint every quote would have parsed as
 *    `NaN`, been filtered out by the finiteness guard, and stored nothing. Both shapes are handled
 *    below, because a provider that changes an array to a map should degrade to a log line rather
 *    than to an empty ledger.
 *
 * ## Authentication
 *
 * HTTP Basic, account API ID as the user and account API key as the password. Both come from the
 * environment (`XE_API_ID`, `XE_API_KEY`) and neither is ever logged — the error paths below print
 * the status and the provider's message, never the request.
 */
@Injectable()
export class XeRatesProvider {
  private readonly logger = new Logger(XeRatesProvider.name);
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = (
      this.configService.get<string>('XE_API_BASE_URL') ?? 'https://xecdapi.xe.com/v1'
    ).replace(/\/$/, '');
  }

  /** Whether credentials are present at all. A deployment without them enters rates by hand. */
  isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('XE_API_ID') && this.configService.get<string>('XE_API_KEY'),
    );
  }

  /**
   * Mid-market quotes for `targets`, expressed as units of each target per unit of `from`.
   *
   * `date` is an ISO day. XE resolves it to that day's close; asking for today returns the latest
   * quote, which is what the daily refresh wants.
   */
  async fetchMidRates(from: string, targets: string[], date: string): Promise<XeQuote[]> {
    if (targets.length === 0) return [];

    // `amount=1` makes `mid` the rate itself rather than a converted amount, which is what the
    // ledger stores. XE caps the `to` list, so the request is chunked rather than sent whole and
    // silently truncated.
    const quotes: XeQuote[] = [];
    for (const chunk of chunked(targets, MAX_TARGETS_PER_REQUEST)) {
      const payload = await this.get<XeHistoricRateResponse>('/historic_rate.json', {
        from,
        to: chunk.join(','),
        amount: '1',
        date,
      });
      quotes.push(...parseQuotes(payload, this.logger));
    }
    return quotes;
  }

  /**
   * The plan the account is on, and therefore whether its rates are real.
   *
   * Cheap, unmetered on XE's side, and the only way to know from inside the product that the
   * numbers arriving are mock data.
   */
  async accountInfo(): Promise<XeAccountInfo> {
    const payload = await this.get<XeAccountInfoResponse>('/account_info.json', {});
    const plan = String(payload?.package ?? '').trim();
    return {
      package: plan || 'desconocido',
      remaining:
        typeof payload?.package_limit_remaining === 'number'
          ? payload.package_limit_remaining
          : null,
      // XE spells it "Freetrial Daily"; matching loosely so a rename of the plan does not silently
      // turn mock rates back on.
      servesMockRates: /free\s*trial/i.test(plan),
    };
  }

  private async get<T>(path: string, query: Record<string, string>): Promise<T> {
    const apiId = this.configService.get<string>('XE_API_ID');
    const apiKey = this.configService.get<string>('XE_API_KEY');
    if (!apiId || !apiKey) {
      throw new BadRequestError('CURRENCIES.PROVEEDOR_TASAS_NO_CONFIGURADO');
    }

    const search = new URLSearchParams(query).toString();
    const url = `${this.baseUrl}${path}${search ? `?${search}` : ''}`;
    const auth = `Basic ${Buffer.from(`${apiId}:${apiKey}`).toString('base64')}`;

    try {
      const response = await firstValueFrom(
        this.httpService.get<T>(url, {
          headers: { Authorization: auth, Accept: 'application/json' },
          timeout: REQUEST_TIMEOUT_MS,
        }),
      );
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<{ message?: string }>;
      const status = axiosError.response?.status;
      const detail =
        axiosError.response?.data?.message ??
        (typeof axiosError.response?.data === 'string' ? axiosError.response.data : undefined) ??
        axiosError.message;
      // Path and status, never the query string and never the credentials.
      this.logger.error(`XE ${path} respondió ${status ?? 'sin estado'}: ${detail}`);
      throw new BadRequestError('CURRENCIES.PROVEEDOR_TASAS_ERROR', {
        provider: 'XE',
        status: status ?? 0,
        detail: String(detail ?? 'error desconocido'),
      });
    }
  }
}

/** XE limits how many currencies one request may quote. */
const MAX_TARGETS_PER_REQUEST = 50;
const REQUEST_TIMEOUT_MS = 20_000;

interface XeHistoricRateResponse {
  from?: string;
  /** Documented as an array; tolerated as a map. */
  to?: unknown;
}

interface XeAccountInfoResponse {
  package?: string;
  package_limit_remaining?: number;
}

/**
 * Read `to` in either shape XE has published it in.
 *
 * Array: `[{ quotecurrency: 'DOP', mid: 60.5 }]` — the documented one.
 * Map:   `{ DOP: 60.5 }` — what the previous parser assumed, and what some mirrors return.
 *
 * A quote that is null, zero or non-numeric is dropped with a warning rather than stored: a thin
 * pair legitimately has no quote some days, and persisting a zero makes every conversion through
 * that pair silently produce nothing.
 */
function parseQuotes(payload: XeHistoricRateResponse, logger: Logger): XeQuote[] {
  const raw = payload?.to;
  if (!raw) return [];

  const candidates: { currency: unknown; rate: unknown }[] = Array.isArray(raw)
    ? raw.map((item) => ({
        currency: (item as Record<string, unknown>)?.['quotecurrency'],
        rate: (item as Record<string, unknown>)?.['mid'],
      }))
    : typeof raw === 'object'
      ? Object.entries(raw as Record<string, unknown>).map(([currency, rate]) => ({
          currency,
          // A map whose values are objects is the array shape with string keys.
          rate:
            rate !== null && typeof rate === 'object'
              ? (rate as Record<string, unknown>)['mid']
              : rate,
        }))
      : [];

  const quotes: XeQuote[] = [];
  for (const candidate of candidates) {
    const currency = String(candidate.currency ?? '').toUpperCase();
    const rate = roundAmount(Number(candidate.rate), 6);
    if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(rate) || rate <= 0) {
      logger.warn(
        `XE devolvió una cotización inutilizable para "${String(candidate.currency)}": ` +
          `${String(candidate.rate)}. Se omite.`,
      );
      continue;
    }
    quotes.push({ currency, rate });
  }
  return quotes;
}

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
