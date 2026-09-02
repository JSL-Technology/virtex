import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import type { VendorBill } from './vendor-bill.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

@Entity()
export class VendorBillLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('VendorBill', 'lines')
  vendorBill: VendorBill;

  @Column()
  product: string;


  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string;

  @Column({ name: 'expense_account_id', type: 'uuid', nullable: true })
  expenseAccountId?: string;


  @Column('decimal', { precision: 10, scale: 2, transformer: numericTransformerNotNull })
  quantity: number;

  @Column('decimal', { precision: 10, scale: 2, transformer: numericTransformerNotNull })
  unitPrice: number;

  @Column('decimal', { precision: 10, scale: 2, transformer: numericTransformerNotNull })
  total: number;
}