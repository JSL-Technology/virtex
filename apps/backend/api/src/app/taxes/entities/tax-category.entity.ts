
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'tax_categories' })
export class TaxCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  organizationId: string;

  @Column()
  name: string;
}