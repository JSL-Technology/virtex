
import { Product } from '../../inventory/entities/product.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { PriceList } from './price-list.entity';

@Entity({ name: 'price_list_items' })
export class PriceListItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('PriceList', 'items', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'price_list_id' })
  priceList: PriceList;

  @Column({ name: 'price_list_id' })
  priceListId: string;

  // Not eager: a line used to carry the whole product (cost, stock, tenant) in every response, which is
  // how a foreign product leaked (audit 2026-10-31, PL-01). The screen needs only the id.
  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ name: 'product_id' })
  productId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  price: number;
}