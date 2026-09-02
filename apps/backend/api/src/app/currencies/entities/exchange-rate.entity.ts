import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

/**
 * A published rate: units of `toCurrency` for one unit of `fromCurrency`, on `date`.
 *
 * ## One row per pair per day
 *
 * There was no uniqueness constraint, so the same pair and date could be stored any number of
 * times. Every lookup orders by `date DESC` and takes the first row, which among same-date
 * duplicates is whichever PostgreSQL happens to return — so converting the same invoice twice could
 * produce two different figures, and the daily refresh appended a new row on each run rather than
 * correcting the existing one.
 *
 * The rate is deliberately not tenant-scoped: what a currency was worth on a given day is a fact
 * about the market, not about the customer. A tenant that must use a specific official source
 * (Banco Central, DOF, TRM) configures that source; it does not get its own arithmetic.
 */
@Entity()
@Index('UQ_exchange_rate_pair_date', ['fromCurrency', 'toCurrency', 'date'], { unique: true })
export class ExchangeRate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 3 })
  fromCurrency: string;

  @Column({ length: 3 })
  toCurrency: string;

  /** Six decimals: enough for a currency pair where one side is a low-denomination unit. */
  @Column('decimal', { precision: 18, scale: 6, transformer: numericTransformerNotNull })
  rate: number;

  /** The calendar day the rate applies to. A rate is a daily fact, not an instant. */
  @Column({ type: 'date' })
  date: Date;
}
