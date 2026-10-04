import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
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
  // ON DELETE RESTRICT (QA C-03): a document outlives any change of mind about the master data it
  // names. See migration ProtectReferencedMasterData.
  @ManyToOne(() => Product, { nullable: true, onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column()
  description: string;

  /** Position on the document: lines read back in the order they were written. */
  @Column({ name: 'line_order', type: 'int', default: 0 })
  lineOrder: number;

  /** Fractional: hours of service and kilograms are quoted too. It was an integer. */
  @Column('decimal', { precision: 18, scale: 6, transformer: numericTransformerNotNull })
  quantity: number;

  @Column('decimal', { precision: 18, scale: 6, transformer: numericTransformerNotNull })
  unitPrice: number;

  @Column('decimal', { name: 'discount_rate', precision: 7, scale: 6, default: 0, transformer: numericTransformerNotNull })
  discountRate: number;

  @Column('decimal', { name: 'tax_rate', precision: 7, scale: 6, default: 0, transformer: numericTransformerNotNull })
  taxRate: number;

  @Column('decimal', { name: 'tax_amount', precision: 18, scale: 2, default: 0, transformer: numericTransformerNotNull })
  taxAmount: number;

  /** quantity × unitPrice less the line discount, before tax. */
  @Column('decimal', { precision: 18, scale: 2, transformer: numericTransformerNotNull })
  lineTotal: number;
}