import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
} from 'typeorm';
import { CustomerPaymentLine } from './customer-payment-line.entity';

@Entity({ name: 'customer_payments' })
export class CustomerPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  organizationId: string;

  @Column()
  customerId: string;

  @Column({ type: 'date' })
  paymentDate: Date;

  @Column()
  bankAccountId: string;

  @Column()
  reference: string;

  @Column('decimal', { precision: 12, scale: 2 })
  totalAmount: number;

  @OneToMany(() => CustomerPaymentLine, (line) => line.payment, {
    cascade: true,
  })
  lines: CustomerPaymentLine[];

  @CreateDateColumn()
  createdAt: Date;
}