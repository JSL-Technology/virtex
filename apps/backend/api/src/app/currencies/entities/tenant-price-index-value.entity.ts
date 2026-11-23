import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A month of a price index one company recorded for itself, because the platform has not loaded it
 * yet — the publisher releases a month's figure weeks after it ends, and a close cannot wait for a
 * release of the product.
 *
 * It only fills a gap: where the platform has the published figure (`price_index_values`), that is
 * the one every company restates with, and a value recorded here for the same month is shown beside
 * it, not used. Versioned the same way — a correction is the next `revision`, never an edit — and
 * under the tenant isolation policy like every other row a company owns.
 */
@Entity({ name: 'tenant_price_index_values' })
@Index('UQ_tenant_price_index_values_revision', ['organizationId', 'seriesCode', 'period', 'revision'], { unique: true })
@Check('CHK_tenant_price_index_values_value', `"value" > 0`)
@Check('CHK_tenant_price_index_values_period', `EXTRACT(DAY FROM "period") = 1`)
@Check('CHK_tenant_price_index_values_revision', `"revision" >= 1`)
@Check('CHK_tenant_price_index_values_series', `"series_code" ~ '^[A-Z]{2}-[A-Z0-9-]{1,37}$'`)
export class TenantPriceIndexValue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /**
   * Mapped only so the foreign key (ON DELETE CASCADE) is part of the schema TypeORM compares; named,
   * not imported, as in `TenantExchangeRate`: reference data must not depend on Identity's entities.
   */
  @ManyToOne('Organization', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_tenant_price_index_values_organization' })
  organization?: unknown;

  @Column({ name: 'series_code', type: 'varchar', length: 40 })
  seriesCode: string;

  @Column({ type: 'date' })
  period: string;

  /** Exact decimal text, as in `PriceIndexValue.value`. */
  @Column({ type: 'numeric', precision: 30, scale: 10 })
  value: string;

  @Column({ type: 'int' })
  revision: number;

  @Column({ name: 'published_on', type: 'date', nullable: true })
  publishedOn: string | null;

  @Column({ type: 'text', nullable: true })
  reference: string | null;

  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt: Date;

  @Column({ name: 'recorded_by_user_id', type: 'uuid', nullable: true })
  recordedByUserId: string | null;
}
