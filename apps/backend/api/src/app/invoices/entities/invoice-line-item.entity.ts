import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Invoice } from './invoice.entity';
import { Product } from '../../inventory/entities/product.entity';


@Entity()
export class InvoiceLineItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Invoice, (invoice) => invoice.lineItems)
  invoice: Invoice;

  @ManyToOne(() => Product)
  product: Product;

  @Column()
  description: string;

  @Column('int')
  quantity: number;

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;

  @Column('decimal', { precision: 5, scale: 2, default: 0 })
  taxRate: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  taxAmount: number;
}