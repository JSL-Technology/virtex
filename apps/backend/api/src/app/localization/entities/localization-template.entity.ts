
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { FiscalRegion } from './fiscal-region.entity';
import { CoaTemplate } from './coa-template.entity';
import { TaxTemplate } from './tax-template.entity';

@Entity({ name: 'localization_templates' })
export class LocalizationTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => FiscalRegion)
  @JoinColumn({ name: 'fiscal_region_id' })
  fiscalRegion: FiscalRegion;

  @Column({ name: 'fiscal_region_id' })
  fiscalRegionId: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ default: true })
  isActive: boolean;

  @OneToMany(() => CoaTemplate, (coa) => coa.template, { cascade: true })
  coaTemplate: CoaTemplate[];

  @OneToMany(() => TaxTemplate, (tax) => tax.template, { cascade: true })
  taxTemplates: TaxTemplate[];
}