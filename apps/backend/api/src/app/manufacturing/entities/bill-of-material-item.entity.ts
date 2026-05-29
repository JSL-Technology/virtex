
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import type { BillOfMaterial } from './bill-of-material.entity';

@Entity('bill_of_material_items')
export class BillOfMaterialItem extends BaseEntity {
  @ManyToOne('BillOfMaterial', 'items')
  @JoinColumn({ name: 'bill_of_material_id' })
  billOfMaterial: BillOfMaterial;

  @Column({ name: 'bill_of_material_id', type: 'uuid' })
  billOfMaterialId: string;

  @Column({ name: 'component_product_id', type: 'uuid' })
  componentProductId: string;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  quantity: number;

  @Column({ name: 'unit_of_measure_id', type: 'uuid', nullable: true })
  unitOfMeasureId: string;
}
