
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Tax } from './tax.entity';
import { FiscalRegion } from '../localization/entities/fiscal-region.entity';

export enum CustomerTaxType {
  INDIVIDUAL = 'INDIVIDUAL',
  CORPORATE = 'CORPORATE',
  GOVERNMENT = 'GOVERNMENT',
}

@Entity({ name: 'tax_rules' })
export class TaxRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @ManyToOne(() => FiscalRegion)
  @JoinColumn({ name: 'fiscal_region_id' })
  fiscalRegion: FiscalRegion;

  @Column({ name: 'product_tax_category_id', nullable: true })
  productTaxCategoryId?: string;

  @Column({ type: 'enum', enum: CustomerTaxType, nullable: true })
  customerTaxType?: CustomerTaxType;

  @ManyToOne(() => Tax)
  @JoinColumn({ name: 'tax_id' })
  tax: Tax;

  @Column({ type: 'int', default: 100 })
  priority: number;

  @Column({ default: false })
  isCompound: boolean;

  @Column({ default: false })
  isWithholding: boolean;
}