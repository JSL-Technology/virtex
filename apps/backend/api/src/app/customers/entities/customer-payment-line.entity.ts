import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { CustomerPayment } from './customer-payment.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';

@Entity({ name: 'customer_payment_lines' })
export class CustomerPaymentLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('CustomerPayment', 'lines')
  @JoinColumn({ name: 'payment_id' })
  payment: CustomerPayment;

  @ManyToOne(() => Invoice)
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column()
  invoiceId: string;

  @Column('decimal', { precision: 12, scale: 2 })
  amount: number;
}