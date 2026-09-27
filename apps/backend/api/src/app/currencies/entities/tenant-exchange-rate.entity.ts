import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { ExchangeRateType } from './exchange-rate.entity';

/**
 * A rate one tenant recorded for itself: the official rate its own tax authority mandates, entered
 * by hand where no API publishes it.
 *
 * ## Why this is not a row in `exchange_rate`
 *
 * `exchange_rate` is shared by every tenant, and recording a rate by hand used to write into it —
 * so one customer typing a rate (or mistyping it) changed how every other customer's foreign
 * invoices were converted. The shared table is now written only by the platform (the provider
 * refresh); a tenant's own rates live here, under the tenant isolation policy, and
 * `ExchangeRateResolver` prefers them for that tenant: the newest quote on or before the date
 * wins, and on the same day the tenant's own rate wins over the shared one.
 */
@Entity({ name: 'tenant_exchange_rates' })
@Index(
  'UQ_tenant_exchange_rates_pair_date_type',
  ['organizationId', 'fromCurrency', 'toCurrency', 'date', 'rateType'],
  { unique: true },
)
export class TenantExchangeRate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /**
   * Mapped only so the foreign key (ON DELETE CASCADE) is part of the schema TypeORM compares.
   * The target is named, not imported: nothing here loads the organization, and the currencies
   * module must not depend on Identity's entity classes to hold a tenant id.
   */
  @ManyToOne('Organization', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_tenant_exchange_rates_org' })
  organization?: unknown;

  @Column({ name: 'from_currency', length: 3 })
  fromCurrency: string;

  @Column({ name: 'to_currency', length: 3 })
  toCurrency: string;

  @Column('decimal', { precision: 18, scale: 6, transformer: numericTransformerNotNull })
  rate: number;

  @Column({ type: 'date' })
  date: Date;

  @Column({
    name: 'rate_type',
    type: 'enum',
    enum: ExchangeRateType,
    enumName: 'exchange_rate_rate_type_enum',
    default: ExchangeRateType.OFFICIAL,
  })
  rateType: ExchangeRateType;

  @Column({ name: 'source', type: 'varchar', length: 32, default: 'MANUAL' })
  source: string;

  @Column({ name: 'recorded_by_user_id', type: 'uuid', nullable: true })
  recordedByUserId: string | null;
}
