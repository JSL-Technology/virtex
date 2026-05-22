
import { Product } from '../../inventory/entities/product.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PriceList } from './price-list.entity';

@Entity({ name: 'price_list_items' })
export class PriceListItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PriceList, (priceList) => priceList.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'price_list_id' })
  priceList: PriceList;

  @Column({ name: 'price_list_id' })
  priceListId: string;

  @ManyToOne(() => Product, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ name: 'product_id' })
  productId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  price: number;
}