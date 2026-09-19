import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
// Type-only: the inverse relation is declared by string name so this module carries no runtime
// import of `taxes`. It mirrors how Tax.taxGroup already references 'TaxGroup', which keeps the
// tax_groups ⇄ taxes relation bidirectional without a compile-time or DI cycle between the modules.
import type { Tax } from '../../taxes/entities/tax.entity';

@Entity({ name: 'tax_groups' })
export class TaxGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  organizationId: string;

  @Column()
  name: string;

  @OneToMany('Tax', 'taxGroup')
  taxes: Tax[];
}