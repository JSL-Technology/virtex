import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import type { Quote } from './quote.entity';
import { Product } from '../../inventory/entities/product.entity';

@Entity({ name: 'quote_lines' })
export class QuoteLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Quote', 'lines', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quote_id' })
  quote: Quote;

  /**
   * `SET NULL`, explicitly.
   *
   * A quote line carries its own description and price, so it stays readable once the catalogue
   * entry is gone — and the default `NO ACTION` blocked tenant deletion.
   */
  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column()
  description: string;

  @Column('int')
  quantity: number;

  @Column('decimal', { precision: 10, scale: 2 })
  unitPrice: number;

  @Column('decimal', { precision: 10, scale: 2 })
  lineTotal: number;
}