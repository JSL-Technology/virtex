import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { VendorBill } from './vendor-bill.entity';

@Entity()
export class VendorBillLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => VendorBill, (vendorBill) => vendorBill.lines)
  vendorBill: VendorBill;

  @Column()
  product: string;


  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string;

  @Column({ name: 'expense_account_id', type: 'uuid', nullable: true })
  expenseAccountId?: string;


  @Column('decimal', { precision: 10, scale: 2 })
  quantity: number;

  @Column('decimal', { precision: 10, scale: 2 })
  unitPrice: number;

  @Column('decimal', { precision: 10, scale: 2 })
  total: number;
}