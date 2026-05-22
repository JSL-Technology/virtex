
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { InvoiceLineItem } from './invoice-line-item.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { Currency } from '../../currencies/entities/currency.entity';
import { Organization } from '../../organizations/entities/organization.entity';

export enum InvoiceStatus {
    DRAFT = 'Draft',
    PENDING = 'Pending',
    PAID = 'Paid',
    PARTIALLY_PAID = 'Partially Paid',
    VOID = 'Void',
    CREDIT_NOTE = 'Credit Note',
}

export enum InvoiceType {
    INVOICE = 'INVOICE',
    CREDIT_NOTE = 'CREDIT_NOTE',
}

@Entity({ name: 'invoices' })
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;
  
  @Column()
  invoiceNumber: string;

  @Column({ name: 'ncf_number', nullable: true })
  ncfNumber?: string;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column()
  customerId: string;

  @Column()
  customerName: string;

  @Column({ type: 'text', nullable: true })
  customerAddress: string;

  @Column('date')
  issueDate: string;

  @Column('date')
  dueDate: string;

  @Column('decimal', { precision: 12, scale: 2, comment: 'Subtotal in transaction currency' })
  subtotal: number;

  @Column('decimal', { precision: 12, scale: 2, comment: 'Tax in transaction currency' })
  tax: number;

  @Column('decimal', { precision: 12, scale: 2, comment: 'Total in transaction currency' })
  total: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0.00, comment: 'Remaining balance in transaction currency' })
  balance: number;

  @Column({
    type: 'enum',
    enum: InvoiceStatus,
    default: InvoiceStatus.DRAFT,
  })
  status: InvoiceStatus;

  @Column({
    type: 'enum',
    enum: InvoiceType,
    default: InvoiceType.INVOICE,
  })
  type: InvoiceType;

  @OneToMany(() => InvoiceLineItem, (line) => line.invoice, { cascade: true, eager: true })
  lineItems: InvoiceLineItem[];

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ name: 'original_invoice_id', nullable: true })
  originalInvoiceId?: string;
  

  @Column({ length: 3, default: 'USD', name: 'currency_code' })
  currencyCode: string;

  @ManyToOne(() => Currency)
  @JoinColumn({ name: 'currency_code', referencedColumnName: 'code' })
  currency: Currency;

  @Column('decimal', { 
    precision: 18, 
    scale: 6, 
    default: 1.0,
    name: 'exchange_rate',
    comment: 'Rate to convert from transaction currency to base currency'
  })
  exchangeRate: number;

  @Column('decimal', { 
    precision: 18, 
    scale: 2, 
    name: 'total_in_base_currency',
    comment: 'Total amount converted to the organization\'s base currency'
  })
  totalInBaseCurrency: number;


  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;


  @VersionColumn()
  version: number;
}