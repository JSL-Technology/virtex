
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
  VersionColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { VendorBillLine } from './vendor-bill-line.entity';
import { Supplier } from '../../suppliers/entities/supplier.entity';
import { Currency } from '../../currencies/entities/currency.entity';
import { Organization } from '../../organizations/entities/organization.entity';

export enum VendorBillStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  OPEN = 'OPEN',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  VOID = 'VOID',
  REJECTED = 'REJECTED',
}

@Entity({ name: 'vendor_bills' })
export class VendorBill {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @ManyToOne(() => Supplier, { eager: true })
  @JoinColumn({ name: 'vendor_id' })
  vendor: Supplier;

  @Column({ name: 'vendor_id' })
  vendorId: string;

  @Column({ nullable: true })
  ncf?: string;

  @Column()
  date: Date;

  @Column()
  dueDate: Date;

  @OneToMany(() => VendorBillLine, (line) => line.vendorBill, { cascade: true })
  lines: VendorBillLine[];

  @Column('decimal', { precision: 12, scale: 2 })
  total: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0.0 })
  balance: number;

  @Column({
    type: 'enum',
    enum: VendorBillStatus,
    default: VendorBillStatus.DRAFT,
  })
  status: VendorBillStatus;

  @Column({ type: 'uuid', name: 'approval_request_id', nullable: true })
  approvalRequestId?: string;


  @Column({ length: 3, default: 'USD', name: 'currency_code' })
  currencyCode: string;

  @ManyToOne(() => Currency)
  @JoinColumn({ name: 'currency_code', referencedColumnName: 'code' })
  currency: Currency;

  @Column('decimal', { precision: 18, scale: 6, default: 1.0, name: 'exchange_rate' })
  exchangeRate: number;

  @Column('decimal', { precision: 18, scale: 2, name: 'total_in_base_currency' })
  totalInBaseCurrency: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;


  @VersionColumn()
  version: number;
}