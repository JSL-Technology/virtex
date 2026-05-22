import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToOne, JoinColumn, CreateDateColumn } from "typeorm";
import { Product } from "./product.entity";


@Entity({ name: 'warehouses' })
export class Warehouse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  address: string;

  @OneToMany(() => Location, location => location.warehouse)
  locations: Location[];
}


@Entity({ name: 'locations' })
export class Location {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @ManyToOne(() => Warehouse, warehouse => warehouse.locations)
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