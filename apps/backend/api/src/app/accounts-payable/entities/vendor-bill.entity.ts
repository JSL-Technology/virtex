
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
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

/**
 * DGII 606 "Tipo de Bienes y Servicios Comprados". A purchase must be classified for the return;
 * without it the 606 cannot be produced at all.
 */
export enum PurchaseCategory {
  PERSONNEL_EXPENSES = '01',
  WORK_GOODS_SERVICES = '02',
  LEASING = '03',
  FIXED_ASSET_LEASING = '04',
  IMPROVEMENT_EXPENSES = '05',
  MERCHANDISE_PURCHASES = '06',
  RELATED_SERVICES = '07',
  FINANCIAL_EXPENSES = '08',
  EXTRAORDINARY_EXPENSES = '09',
  COST_OF_SALES = '10',
  ASSET_ACQUISITIONS = '11',
  INSURANCE_EXPENSES = '12',
}

/** DGII 606 "Tipo de Retención en ISR". */
export enum IsrRetentionType {
  NONE = '',
  RENT = '01',
  FEES_FOR_SERVICES = '02',
  OTHER_INCOME = '03',
  PRESUMED_INCOME = '04',
  UNDECLARED_MOVABLE_PROPERTY = '05',
  OTHER = '06',
}

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

  /**
   * NCF of the comprobante this one modifies, on a supplier credit/debit note.
   * The 606 has a dedicated column for it and it was never captured.
   */
  @Column({ name: 'ncf_modified', type: 'varchar', nullable: true })
  ncfModified?: string | null;

  /** When the bill was actually paid; the 606 reports it separately from the document date. */
  @Column({ name: 'paid_at', type: 'date', nullable: true })
  paidAt?: string | null;

  // ── Fiscal breakdown ───────────────────────────────────────────────────────
  //
  // `total` alone cannot produce a compliant 606. The report asks for goods and services
  // separately, for the tax actually borne, for what was withheld and for the excise and other
  // levies. Deriving them by dividing the total by 1.18 — which is what the previous report did —
  // assumes every purchase is taxable at the standard rate and is wrong for exempt purchases,
  // services subject to withholding, and anything bearing excise.

  @Column('decimal', {
    name: 'services_amount',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  servicesAmount: number;

  @Column('decimal', {
    name: 'goods_amount',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  goodsAmount: number;

  /** Consumption tax borne on the purchase (ITBIS facturado). */
  @Column('decimal', {
    name: 'tax_amount',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  taxAmount: number;

  /** Consumption tax we withheld from the supplier and must remit. */
  @Column('decimal', {
    name: 'tax_withheld',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  taxWithheld: number;

  /** Income tax withheld from the supplier. */
  @Column('decimal', {
    name: 'income_tax_withheld',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  incomeTaxWithheld: number;

  /** Consumption tax that cannot be deducted and is carried to cost. */
  @Column('decimal', {
    name: 'tax_to_cost',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  taxToCost: number;

  /** Consumption tax subject to the proportionality rule (Art. 349). */
  @Column('decimal', {
    name: 'tax_proportional',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  taxProportional: number;

  @Column('decimal', {
    name: 'excise_amount',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  exciseAmount: number;

  @Column('decimal', {
    name: 'other_taxes',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  otherTaxes: number;

  @Column('decimal', {
    name: 'service_charge',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  serviceCharge: number;

  @Column({
    name: 'purchase_category',
    type: 'varchar',
    length: 2,
    default: PurchaseCategory.MERCHANDISE_PURCHASES,
  })
  purchaseCategory: string;

  @Column({ name: 'isr_retention_type', type: 'varchar', length: 2, nullable: true })
  isrRetentionType?: string | null;

  /** DGII "Forma de Pago" code (01 efectivo, 02 cheque/transferencia…). */
  @Column({ name: 'payment_form', type: 'varchar', length: 2, default: '01' })
  paymentForm: string;

  @Column('decimal', { precision: 12, scale: 2, transformer: numericTransformerNotNull })
  total: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0.0, transformer: numericTransformerNotNull })
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

  @Column('decimal', { precision: 18, scale: 6, default: 1.0, name: 'exchange_rate', transformer: numericTransformerNotNull })
  exchangeRate: number;

  @Column('decimal', { precision: 18, scale: 2, name: 'total_in_base_currency', transformer: numericTransformerNotNull })
  totalInBaseCurrency: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;


  @VersionColumn()
  version: number;
}