import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import type { PaymentBatch } from './payment-batch.entity';

@Entity()
export class VendorPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  

  @ManyToOne('PaymentBatch', 'payments', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_batch_id' })
  paymentBatch: PaymentBatch;

  @Column()
  vendorBillId: string;

  @Column()
  date: Date;

  @Column('decimal', { precision: 10, scale: 2 })
  amount: number;
}