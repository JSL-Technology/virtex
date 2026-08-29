import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Product } from './product.entity';
import { Warehouse } from '../../supply-chain/entities/warehouse.entity';

/**
 * `Warehouse` is defined once, in supply-chain, and re-exported here for the inventory entities
 * that reference it.
 *
 * This file used to declare a SECOND `@Entity({ name: 'warehouses' })` class. Two entities
 * mapped to the same table is a silent collision: whichever loaded last defined the table, so
 * the schema TypeORM generated depended on module load order, and a generated migration wanted
 * to drop every column the other definition contributed. The duplicate also had no
 * `organization_id`, so warehouses reached through inventory were outside tenant scoping
 * entirely.
 */
export { Warehouse };


@Entity({ name: 'locations' })
export class Location {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  /**
   * One-directional on purpose.
   *
   * This declared an inverse side, `warehouse => warehouse.locations`, against a property
   * `Warehouse` does not have — so TypeScript reported it and TypeORM would refuse to build the
   * metadata (`Entity metadata for Warehouse#locations was not found`) the moment anything
   * traversed it. Nothing needs the reverse traversal, so the relation now says what it is.
   */
  @ManyToOne(() => Warehouse)
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;

  @Column()
  warehouseId: string;
}


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



@Entity({ name: 'stock_movements' })
export class StockMovement {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => Product)
    @JoinColumn({ name: 'product_id' })
    product: Product;

    @Column()
    productId: string;

    @Column({ type: 'decimal', precision: 12, scale: 4 })
    quantity: number;

    @Column({ type: 'decimal', precision: 12, scale: 2 })
    cost: number;

    @Column()
    type: 'PURCHASE_RECEIPT' | 'SALE_DISPATCH' | 'ADJUSTMENT' | 'TRANSFER_OUT' | 'TRANSFER_IN';

    @Column()
    reference: string;

    @CreateDateColumn()
    date: Date;
}