
import { Entity, Column, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { BillOfMaterialItem } from './bill-of-material-item.entity';

@Entity('bill_of_materials')
export class BillOfMaterial extends BaseEntity {
  @Column()
  name: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ default: '1.0' })
  version: string;

  @Column({ default: true })
  isActive: boolean;

  @OneToMany(() => BillOfMaterialItem, (item) => item.billOfMaterial, { cascade: true })
  items: BillOfMaterialItem[];
}
