
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'tax_configurations' })
export class TaxConfiguration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  organizationId: string;

  @Column()
  taxId: string;

  @Column({ nullable: true })
  countryCode?: string;

  @Column({ nullable: true })
  productCategoryId?: string;

  @Column({ nullable: true })
  customerTaxType?: 'INDIVIDUAL' | 'CORPORATE';

  @Column()
  priority: number;
}
