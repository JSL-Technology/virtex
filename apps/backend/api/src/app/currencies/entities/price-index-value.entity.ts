import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One month of a general price index, as the platform loaded it from the official publication
 * (audit 2026-11-07, FIN-AC-04).
 *
 * The inflation adjustment used to read a «monthly rate» per ORGANIZATION (`inflation_indices`, no
 * endpoint to load it, 0 rows): each company would have typed its own inflation, and nothing tied
 * the figure to the index its profession prescribes. The index is a fact about a market — the
 * FACPCE series in Argentina, the BCV's INPC in Venezuela, declared by the market package
 * (`MarketAccounting.inflationAccounting.series`) — and its values are shared reference data, like
 * the published exchange rates: no `organization_id`, no row-level security, written only through
 * a platform permission.
 *
 * ## Versioned, never rewritten
 *
 * An index is revised: a provisional figure is replaced by the final one, an agency corrects a
 * month. A restatement posted with the old figure must stay explainable, so a correction is a NEW
 * row with the next `revision`, and the value of a month is its highest revision. The application
 * role cannot UPDATE or DELETE these rows (migration 1789770000000); each restatement run records
 * the revision of every month it used, and says so when a newer one appears.
 */
@Entity({ name: 'price_index_values' })
@Index('UQ_price_index_values_revision', ['seriesCode', 'period', 'revision'], { unique: true })
@Check('CHK_price_index_values_value', `"value" > 0`)
@Check('CHK_price_index_values_period', `EXTRACT(DAY FROM "period") = 1`)
@Check('CHK_price_index_values_revision', `"revision" >= 1`)
@Check('CHK_price_index_values_series', `"series_code" ~ '^[A-Z]{2}-[A-Z0-9-]{1,37}$'`)
export class PriceIndexValue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The series, by the code its market declares (`AR-FACPCE`). */
  @Column({ name: 'series_code', type: 'varchar', length: 40 })
  seriesCode: string;

  /** The month, as its first day: `2026-03-01`. */
  @Column({ type: 'date' })
  period: string;

  /**
   * The index level, as published (100 in the series' base period), as exact decimal text: a level
   * can carry more significant digits than a JavaScript number holds — after years of
   * hyperinflation an index runs to many digits before its decimals — and a coefficient computed
   * from a rounded level is a wrong one.
   */
  @Column({ type: 'numeric', precision: 30, scale: 10 })
  value: string;

  @Column({ type: 'int' })
  revision: number;

  /** When the publisher released this figure, where known. */
  @Column({ name: 'published_on', type: 'date', nullable: true })
  publishedOn: string | null;

  /** The publication it was read from — what an accountant checks it against. */
  @Column({ type: 'text', nullable: true })
  reference: string | null;

  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt: Date;

  @Column({ name: 'recorded_by_user_id', type: 'uuid', nullable: true })
  recordedByUserId: string | null;
}
