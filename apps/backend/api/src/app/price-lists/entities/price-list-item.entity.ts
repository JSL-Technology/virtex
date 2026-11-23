
import { Product } from '../../inventory/entities/product.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import type { PriceList } from './price-list.entity';
import { numericTransformerNotNull, numericTransformerWithDefault } from '../../common/database/numeric.transformer';

@Entity({ name: 'price_list_items' })
@Index('UQ_price_list_items_product_break', ['priceListId', 'productId', 'minQuantity'], { unique: true })
@Check('CHK_price_list_items_min_quantity', '"min_quantity" > 0')
@Check('CHK_price_list_items_price', '"price" >= 0')
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

  /** Unit price before tax, in the list's currency. Six decimals, like every price on a document. */
  @Column({ type: 'decimal', precision: 18, scale: 6, transformer: numericTransformerNotNull })
  price: number;

  /**
   * The quantity from which this price applies: a list may carry several prices for one product
   * (1 → 100, 12 → 90, 100 → 80) and a line takes the one with the largest minimum it reaches.
   */
  @Column({ name: 'min_quantity', type: 'decimal', precision: 14, scale: 4, default: 1, transformer: numericTransformerWithDefault })
  minQuantity: number;
}