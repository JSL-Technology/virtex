import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../users/entities/user.entity/user.entity';
import { Opportunity } from './opportunity.entity';
import { QuoteLine } from './quote-line.entity';
import { Currency } from '../currencies/entities/currency.entity';

export enum QuoteStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  INVOICED = 'INVOICED',
}

@Entity({ name: 'quotes' })
export class Quote {
  @PrimaryGeneratedColumn('uuid')
  id: string;


  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ unique: true })
  quoteNumber: string;

  @ManyToOne(() => Customer, { eager: true })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @ManyToOne(() => Opportunity, { nullable: true })
  @JoinColumn({ name: 'opportunity_id' })
  opportunity?: Opportunity;

  @OneToMany(() => QuoteLine, (line) => line.quote, { cascade: true, eager: true })
  lines: QuoteLine[];

  @Column({ type: 'date' })
  issueDate: Date;

  @Column({ type: 'date' })
  expiryDate: Date;

  @Column('decimal', { precision: 12, scale: 2, comment: 'Subtotal in transaction currency' })
  subtotal: number;

  @Column('decimal', { precision: 12, scale: 2, comment: 'Total in transaction currency' })
  total: number;
  

  @Column({ length: 3, name: 'currency_code' })
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


  @Column({ type: 'enum', enum: QuoteStatus, default: QuoteStatus.DRAFT })
  status: QuoteStatus;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}