import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, LessThanOrEqual } from 'typeorm';
import { ExchangeRate, ExchangeRateType } from './entities/exchange-rate.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { BadRequestError } from '../i18n/localized.exception';
import { convert, roundAmount } from '../common/money';
import { toIsoDate } from '../common/dates';

/** How a rate was arrived at, so a posting can be substantiated rather than trusted. */
export interface ResolvedRate {
  rate: number;
  from: string;
  to: string;
  date: string;
  rateType: ExchangeRateType;
  /** `DIRECT`, `INVERSE`, or `TRIANGULATED` through the pivot named in `via`. */
  method: 'IDENTITY' | 'DIRECT' | 'INVERSE' | 'TRIANGULATED';
  via?: string;
  source: string;
  /** The day the underlying quote is from, which may be earlier than `date`. */
  quotedOn: string;
}

/**
 * The pivot every cross rate goes through when no direct quote exists.
 *
 * The US dollar, because that is what the market quotes against and what every provider publishes.
 * A tenant with a COP base invoicing in EUR has no EUR/COP quote on file and never will — the daily
 * refresh only ever fetched pairs against one configured base — so the conversion has to be
 * EUR→USD→COP or it does not happen at all.
 */
const PIVOT = 'USD';

/**
 * The rate that converts an amount from one currency into another on a given date.
 *
 * ## Why the direction needed its own home
 *
 * `exchange_rates` stores `rate` as units of `toCurrency` for one unit of `fromCurrency`. Accounts
 * payable looked up `fromCurrency: base, toCurrency: foreign` — a base→foreign rate — and then
 * **multiplied** the foreign-currency invoice total by it. With a DOP base and a USD 100 invoice at
 * roughly 0.017 USD per DOP, the amount recorded in the books was about 1.70 DOP instead of 5,880.
 * The mistake is invisible at the call site because a rate is just a number; naming the two
 * currencies in the signature is what makes it impossible.
 *
 * ## Three failures this closes
 *
 * 1. **No triangulation.** A pair with neither a direct nor an inverse quote threw. Since the
 *    scheduled refresh only fetched pairs against a single global `BASE_CURRENCY`, that was every
 *    cross rate: a Colombian tenant could not book a euro invoice at all.
 * 2. **No rate type.** One row per pair per day meant an official rate and a market rate
 *    overwrote each other, and nothing recorded which one a posted document had used — in a
 *    region where the authority publishes the rate you are obliged to use.
 * 3. **Silent staleness.** The lookup takes the newest quote at or before the date, which is
 *    right, but said nothing about how old it was. A rate six months stale converts as
 *    confidently as this morning's. `resolve` reports `quotedOn`, and a caller that wants to
 *    refuse a stale rate can.
 */
@Injectable()
export class ExchangeRateResolver {
  private readonly logger = new Logger(ExchangeRateResolver.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Units of `toCurrency` for one unit of `fromCurrency`, on the latest date at or before `asOf`.
   *
   * Returns 1 when the currencies match, so callers need no special case for a domestic document.
   */
  async rateFor(
    fromCurrency: string,
    toCurrency: string,
    asOf: Date | string,
    manager?: EntityManager,
    rateType?: ExchangeRateType,
  ): Promise<number> {
    return (await this.resolve(fromCurrency, toCurrency, asOf, manager, rateType)).rate;
  }

  /**
   * The rate, and how it was arrived at.
   *
   * Prefer this over `rateFor` anywhere the answer is stored or reported: `method`, `source` and
   * `quotedOn` are what let an auditor reconstruct a foreign-currency posting, and none of them
   * were recorded anywhere before.
   */
  async resolve(
    fromCurrency: string,
    toCurrency: string,
    asOf: Date | string,
    manager?: EntityManager,
    rateType?: ExchangeRateType,
  ): Promise<ResolvedRate> {
    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();
    const date = toIsoDate(asOf);
    const type = rateType ?? ExchangeRateType.OFFICIAL;

    if (from === to) {
      return {
        rate: 1,
        from,
        to,
        date,
        rateType: type,
        method: 'IDENTITY',
        source: 'IDENTITY',
        quotedOn: date,
      };
    }

    const em = manager ?? this.dataSource.manager;

    const direct = await this.lookup(em, from, to, date, type);
    if (direct) {
      return {
        rate: Number(direct.rate),
        from,
        to,
        date,
        rateType: direct.rateType,
        method: 'DIRECT',
        source: direct.source,
        quotedOn: toIsoDate(direct.date),
      };
    }

    // A tenant maintains DOP→USD or USD→DOP, rarely both.
    const inverse = await this.lookup(em, to, from, date, type);
    if (inverse && Number(inverse.rate) > 0) {
      return {
        rate: 1 / Number(inverse.rate),
        from,
        to,
        date,
        rateType: inverse.rateType,
        method: 'INVERSE',
        source: inverse.source,
        quotedOn: toIsoDate(inverse.date),
      };
    }

    // Cross rate through the dollar. Both legs must exist; a cross built from one leg and a guess
    // is the `|| 1` this replaces.
    if (from !== PIVOT && to !== PIVOT) {
      const [leg1, leg2] = await Promise.all([
        this.resolveOrNull(em, from, PIVOT, date, type),
        this.resolveOrNull(em, PIVOT, to, date, type),
      ]);
      if (leg1 && leg2) {
        return {
          // Not rounded to the minor unit: this is a rate, not an amount, and rounding it here
          // would move the converted figure by more than the rounding saved.
          rate: leg1.rate * leg2.rate,
          from,
          to,
          date,
          rateType: type,
          method: 'TRIANGULATED',
          via: PIVOT,
          source: `${leg1.source}+${leg2.source}`,
          quotedOn: leg1.quotedOn < leg2.quotedOn ? leg1.quotedOn : leg2.quotedOn,
        };
      }
    }

    // A tenant whose books are kept at the official rate but who has only a market quote on file
    // is better served by the market quote and a warning than by a refusal — but never silently.
    if (type === ExchangeRateType.OFFICIAL) {
      const fallback = await this.resolveOrNull(em, from, to, date, ExchangeRateType.MARKET);
      if (fallback) {
        this.logger.warn(
          `Sin tasa ${type} de ${from} a ${to} al ${date}; se usa ${fallback.rateType} de ${fallback.source}.`,
        );
        return fallback;
      }
    }

    throw new BadRequestError(
      'CURRENCIES.NO_ENCONTRO_TASA_CAMBIO_VALIDA_FECHA_ESPECIFICADA',
      { from, to, date },
    );
  }

  /** `amount` expressed in `toCurrency`, rounded to the minor unit. */
  async convertAmount(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    asOf: Date | string,
    manager?: EntityManager,
    rateType?: ExchangeRateType,
  ): Promise<{ amount: number; rate: number; resolved: ResolvedRate }> {
    const resolved = await this.resolve(fromCurrency, toCurrency, asOf, manager, rateType);
    return {
      amount: convert(amount, resolved.rate),
      // Six decimals, matching the column. `convert` above uses the unrounded rate, so the amount
      // and the stored rate can disagree in the last cent for a large conversion; storing the rate
      // the amount was actually computed with is the only way they agree.
      rate: roundAmount(resolved.rate, 6),
      resolved,
    };
  }

  /** The rate type this tenant keeps its books at. */
  async rateTypeFor(
    organizationId: string,
    manager?: EntityManager,
  ): Promise<ExchangeRateType> {
    const settings = await (manager ?? this.dataSource.manager).findOneBy(OrganizationSettings, {
      organizationId,
    });
    return (settings?.exchangeRateType as ExchangeRateType) ?? ExchangeRateType.OFFICIAL;
  }

  private async resolveOrNull(
    em: EntityManager,
    from: string,
    to: string,
    date: string,
    type: ExchangeRateType,
  ): Promise<ResolvedRate | null> {
    const direct = await this.lookup(em, from, to, date, type);
    if (direct) {
      return {
        rate: Number(direct.rate),
        from,
        to,
        date,
        rateType: direct.rateType,
        method: 'DIRECT',
        source: direct.source,
        quotedOn: toIsoDate(direct.date),
      };
    }
    const inverse = await this.lookup(em, to, from, date, type);
    if (inverse && Number(inverse.rate) > 0) {
      return {
        rate: 1 / Number(inverse.rate),
        from,
        to,
        date,
        rateType: inverse.rateType,
        method: 'INVERSE',
        source: inverse.source,
        quotedOn: toIsoDate(inverse.date),
      };
    }
    return null;
  }

  private lookup(
    em: EntityManager,
    from: string,
    to: string,
    date: string,
    rateType: ExchangeRateType,
  ): Promise<ExchangeRate | null> {
    return em.findOne(ExchangeRate, {
      where: {
        fromCurrency: from,
        toCurrency: to,
        rateType,
        // A `date` column compared against an `IsoDate`. It used to be compared against a `Date`
        // built at 23:59:59.999Z, which is a timestamp comparison against a date column and pulls
        // in the following day either side of a timezone boundary.
        date: LessThanOrEqual(date as unknown as Date),
      },
      order: { date: 'DESC' },
    });
  }
}
