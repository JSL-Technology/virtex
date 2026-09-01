
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import type { FiscalRegion } from './fiscal-region.entity';


/**
 * One tax within a region's scheme, as stored in the scheme's JSON column.
 *
 * A concrete shape rather than `Record<string, unknown>`: an index signature of `unknown` is not
 * assignable to TypeORM's `QueryDeepPartialEntity`, so it made every `update()` of any entity that
 * transitively reaches a `TaxScheme` fail to type-check.
 */
export interface TaxSchemeConfiguration {
  name: string;
  /** Percentage points: `18` means 18 %. */
  rate: number;
  /** How the tax is computed: a percentage of the base, or a fixed amount per unit. */
  computation: 'Porcentaje' | 'Fijo';
  /** What the tax is — VAT, sales tax, excise. Descriptive. */
  regime?: string;
}

@Entity({ name: 'tax_schemes' })
export class TaxScheme {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ name: 'fiscal_region_id' })
  fiscalRegionId: string;

  @ManyToOne('FiscalRegion', 'taxSchemes')
  @JoinColumn({ name: 'fiscal_region_id' })
  fiscalRegion: FiscalRegion;
  
  /**
   * Free-form scheme configuration, kept as JSON.
   *
   * It used to be typed against `TaxConfiguration`, an entity that was registered in no module: its
   * table existed and nothing ever read or wrote it, and the only service that referenced it loaded
   * EVERY tenant's tax rules with `find({ where: {} })` and applied them without filtering. That
   * engine is gone; tax classification lives on the catalogue and the arithmetic in
   * `invoices/sales-tax.engine.ts`, both tenant-scoped by construction.
   */
  @Column({ type: 'jsonb' })
  configurations: TaxSchemeConfiguration[];
}