import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import type { PaymentBatch } from './payment-batch.entity';
import type { VendorBill } from './vendor-bill.entity';
import { numericTransformer, numericTransformerNotNull } from '../../common/database/numeric.transformer';

/**
 * One bill settled, in whole or in part, by one payment run.
 *
 * The previous shape held only the bill, a date and an amount, because the only thing that could
 * produce it paid every selected bill in full. It could not express a partial settlement, an
 * early-payment discount, a withholding, or what the payment was worth in the books when the bill
 * was in another currency — all of which are ordinary, and the last of which is the difference
 * between a correct ledger and a wrong one.
 */
@Entity()
@Index('IDX_vendor_payments_bill', ['vendorBillId'])
export class VendorPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('PaymentBatch', 'payments', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_batch_id' })
  paymentBatch: PaymentBatch;

  @Column({ name: 'payment_batch_id', type: 'uuid' })
  paymentBatchId: string;

  @ManyToOne('VendorBill', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vendor_bill_id' })
  vendorBill: VendorBill;

  @Column({ name: 'vendor_bill_id', type: 'uuid' })
  vendorBillId: string;

  @Column({ type: 'date' })
  date: Date;

  /** Settled against the bill, in the bill's currency. */
  @Column('decimal', { precision: 18, scale: 2, transformer: numericTransformerNotNull })
  amount: number;

  /** What left the bank, in the bank account's currency. */
  @Column('decimal', {
    name: 'amount_paid',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  amountPaid: number;

  @Column('decimal', {
    name: 'tax_withheld',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  taxWithheld: number;

  @Column('decimal', {
    name: 'income_tax_withheld',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  incomeTaxWithheld: number;

  @Column('decimal', {
    name: 'discount',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  discount: number;

  /**
   * Realised exchange difference on this settlement.
   *
   * A bill booked at one rate and paid at another produces a gain or loss the moment cash moves.
   * Nothing recorded it, so a multicurrency payables ledger drifted by exactly this amount on every
   * payment and the difference had nowhere to go.
   */
  @Column('decimal', {
    name: 'exchange_difference',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  exchangeDifference: number;

  @Column('decimal', {
    name: 'exchange_rate',
    precision: 18,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  exchangeRate?: number;
}
