import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

/**
 * Which rate this is.
 *
 * A currency pair does not have *a* rate on a day; it has several, and which one a document must
 * use is a legal question, not a preference. Colombia's TRM, Mexico's DOF FIX and the Dominican
 * Republic's DGII rate are each the official accounting rate for their jurisdiction and each
 * differs from the interbank mid the market quotes. Argentina has run several simultaneously.
 *
 * The table held one rate per pair per day with no type, so an official rate and a market rate
 * overwrote each other and nothing could say which one a posted document had used.
 */
export enum ExchangeRateType {
  /** The rate the tax authority publishes for accounting and tax purposes. */
  OFFICIAL = 'OFFICIAL',
  /** Interbank mid. What a market data provider quotes. */
  MARKET = 'MARKET',
  /** Bank buy and sell, for a tenant that books at the rate its own bank gave it. */
  BUY = 'BUY',
  SELL = 'SELL',
}

/**
 * A published rate: units of `toCurrency` for one unit of `fromCurrency`, on `date`.
 *
 * ## One row per pair, per day, per type, per source
 *
 * There was no uniqueness constraint at all, so the same pair and date could be stored any number
 * of times; every lookup ordered by `date DESC` and took the first row, which among same-date
 * duplicates is whichever PostgreSQL happens to return. Converting the same invoice twice could
 * produce two different figures. A unique index landed later on `(from, to, date)` — which fixed
 * the duplicates and made it impossible to hold an official rate and a market rate for the same
 * day, which is the normal case in most of this product's markets.
 *
 * The rate is deliberately not tenant-scoped: what a currency was worth on a given day is a fact
 * about the market, not about the customer. Which *type* a tenant books at is a tenant decision,
 * and lives in `OrganizationSettings.exchangeRateType`.
 */
@Entity()
@Index('UQ_exchange_rate_pair_date_type', ['fromCurrency', 'toCurrency', 'date', 'rateType'], {
  unique: true,
})
// The lookup is always "this pair, this type, on or before this date, newest first".
@Index('IDX_exchange_rate_lookup', ['fromCurrency', 'toCurrency', 'rateType', 'date'])
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

  @Column({
    name: 'rate_type',
    type: 'enum',
    enum: ExchangeRateType,
    default: ExchangeRateType.OFFICIAL,
  })
  rateType: ExchangeRateType;

  /**
   * Where the figure came from — `DGII`, `DOF`, `TRM`, `BCRA`, `SUNAT`, `XE`, `MANUAL`.
   *
   * An auditor asked to substantiate a foreign-currency posting asks this first, and it was not
   * recorded: every rate in the table came from a commercial market-data provider and there was
   * nothing to say so.
   */
  @Column({ name: 'source', type: 'varchar', length: 32, default: 'MANUAL' })
  source: string;

  /** Who entered it, when it was entered by hand rather than fetched. */
  @Column({ name: 'recorded_by_user_id', type: 'uuid', nullable: true })
  recordedByUserId: string | null;
}
