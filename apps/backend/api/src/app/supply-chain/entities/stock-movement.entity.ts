import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Product } from '../../inventory/entities/product.entity';

/**
 * Audit trail of every quantity change for a product.
 *
 * Moved from inventory/entities/warehouse.entity.ts — stock movements are warehouse
 * history and belong to supply-chain, not the product catalogue.
 */
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
