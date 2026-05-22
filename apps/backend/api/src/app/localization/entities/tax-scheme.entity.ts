
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { FiscalRegion } from './fiscal-region.entity';
import { TaxConfiguration } from '../../taxes/entities/tax-configuration.entity';

@Entity({ name: 'tax_schemes' })
export class TaxScheme {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ name: 'fiscal_region_id' })
  fiscalRegionId: string;

  @ManyToOne(() => FiscalRegion, region => region.taxSchemes)
  @JoinColumn({ name: 'fiscal_region_id' })
  fiscalRegion: FiscalRegion;
  
  @Column({ type: 'jsonb' })
  configurations: Partial<TaxConfiguration>[];
}