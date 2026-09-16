import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Warehouse } from './warehouse.entity';
import { Product } from '../../inventory/entities/product.entity';

/**
 * Current stock holding for one product at one warehouse, with lot and expiry tracking.
 *
 * Moved from inventory/entities/warehouse.entity.ts — stock items describe warehouse
 * state and belong to supply-chain, not the product catalogue.
 */
@Entity({ name: 'stock_items' })
export class StockItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column()
  productId: string;

  @ManyToOne(() => Warehouse)
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;

  @Column()
  warehouseId: string;

  @Column({ type: 'decimal', precision: 12, scale: 4 })
  quantityOnHand: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0 })
  quantityAllocated: number;

  @Column({ nullable: true })
  lotNumber?: string;

  @Column({ nullable: true })
  serialNumber?: string;

  @Column({ type: 'date', nullable: true })
  expiryDate?: Date;
}
