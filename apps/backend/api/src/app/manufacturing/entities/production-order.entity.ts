
import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { BillOfMaterial } from './bill-of-material.entity';

export enum ProductionStatus {
  PLANNED = 'PLANNED',
  RELEASED = 'RELEASED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

@Entity('production_orders')
// An order number is a per-tenant series, not a global one. The `unique: true` on the column made
// it global, so the first tenant to book `PO-0001` blocked it for every other tenant.
@Index('IDX_production_orders_org_order_number', ['organizationId', 'orderNumber'], {
  unique: true,
})
export class ProductionOrder extends BaseEntity {
  @Column()
  orderNumber: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => BillOfMaterial)
  @JoinColumn({ name: 'bill_of_material_id' })
  billOfMaterial: BillOfMaterial;

  @Column({ name: 'bill_of_material_id', type: 'uuid', nullable: true })
  billOfMaterialId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  quantityPlanned: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  quantityProduced: number;

  @Column({
    type: 'enum',
    enum: ProductionStatus,
    default: ProductionStatus.PLANNED
  })
  status: ProductionStatus;

  @Column({ name: 'start_date', type: 'timestamptz', nullable: true })
  startDate: Date;

  @Column({ name: 'end_date', type: 'timestamptz', nullable: true })
  endDate: Date;
}
