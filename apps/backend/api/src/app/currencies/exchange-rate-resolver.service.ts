import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, LessThanOrEqual } from 'typeorm';
import { ExchangeRate } from './entities/exchange-rate.entity';
import { BadRequestError } from '../i18n/localized.exception';
import { convert, roundAmount } from '../common/money';
import { toIsoDate } from '../chart-of-accounts/account-balances.service';

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
 * A rate stored in only one direction is used in the other by inverting it, rather than failing.
 * A tenant maintains DOP→USD or USD→DOP, rarely both.
 */
@Injectable()
export class ExchangeRateResolver {
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
  ): Promise<number> {
    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();
    if (from === to) return 1;

    const em = manager ?? this.dataSource.manager;
    const date = new Date(`${toIsoDate(asOf)}T23:59:59.999Z`);

    const direct = await em.findOne(ExchangeRate, {
      where: { fromCurrency: from, toCurrency: to, date: LessThanOrEqual(date) },
      order: { date: 'DESC' },
    });
    if (direct && Number(direct.rate) > 0) return Number(direct.rate);

    const inverse = await em.findOne(ExchangeRate, {
      where: { fromCurrency: to, toCurrency: from, date: LessThanOrEqual(date) },
      order: { date: 'DESC' },
    });
    if (inverse && Number(inverse.rate) > 0) {
      return 1 / Number(inverse.rate);
    }

    throw new BadRequestError(
      'CURRENCIES.NO_ENCONTRO_TASA_CAMBIO_VALIDA_FECHA_ESPECIFICADA',
      { from, to, date: toIsoDate(asOf) },
    );
  }

  /** `amount` expressed in `toCurrency`, rounded to the minor unit. */
  async convertAmount(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    asOf: Date | string,
    manager?: EntityManager,
  ): Promise<{ amount: number; rate: number }> {
    const rate = await this.rateFor(fromCurrency, toCurrency, asOf, manager);
    return { amount: convert(amount, rate), rate: roundAmount(rate, 6) };
  }
}
