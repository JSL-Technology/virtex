import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import type { CustomerPayment } from './customer-payment.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';
import {
  numericTransformer,
  numericTransformerNotNull,
} from '../../common/database/numeric.transformer';

/** One invoice settled, in whole or in part, by one receipt. */
@Entity({ name: 'customer_payment_lines' })
@Index('IDX_customer_payment_lines_invoice', ['invoiceId'])
export class CustomerPaymentLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('CustomerPayment', 'lines', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_id' })
  payment: CustomerPayment;

  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId: string;

  @ManyToOne(() => Invoice, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  /** Relieved from the invoice, in the invoice's currency. */
  @Column('decimal', { precision: 18, scale: 2, transformer: numericTransformerNotNull })
  amount: number;

  /**
   * Consumption tax the customer withheld from us on this collection.
   *
   * Recoverable against our own return, so it settles the receivable without cash arriving. It is
   * routine across the region and there was no field for it: the receipt had to pretend the full
   * amount was collected in cash.
   */
  @Column('decimal', {
    name: 'tax_withheld',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  taxWithheld: number;

  /** Income tax the customer withheld from us on this collection. */
  @Column('decimal', {
    name: 'income_tax_withheld',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  incomeTaxWithheld: number;

  /** Settlement discount granted. */
  @Column('decimal', {
    name: 'discount',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  discount: number;

  /** Realised exchange difference between the invoice's rate and the receipt's. */
  @Column('decimal', {
    name: 'exchange_difference',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  exchangeDifference: number;
}
