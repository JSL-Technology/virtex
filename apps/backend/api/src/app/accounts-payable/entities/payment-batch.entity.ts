import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { VendorPayment } from './vendor-payment.entity';

export enum PaymentBatchStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  PAID = 'PAID',
}

@Entity({ name: 'payment_batches' })
export class PaymentBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;
  
  @Column({ type: 'date' })
  paymentDate: Date;
  
  @Column({ name: 'bank_account_id' })
  bankAccountId: string;

  @Column({ type: 'enum', enum: PaymentBatchStatus, default: PaymentBatchStatus.PENDING })
  status: PaymentBatchStatus;
  
  @OneToMany(() => VendorPayment, payment => payment.paymentBatch)
  payments: VendorPayment[];
}