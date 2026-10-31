import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { BranchRef, IssuedAtBranch } from '../../organizations/contracts/branch.contract';
import { Customer } from '../../customers/entities/customer.entity';
import { SalesOrderLine } from './sales-order-line.entity';

export enum SalesOrderStatus {
  /** Accepted by the company; nothing delivered yet. */
  CONFIRMED = 'CONFIRMED',
  PARTIALLY_DELIVERED = 'PARTIALLY_DELIVERED',
  /** Every line delivered (services count as delivered when invoiced). */
  DELIVERED = 'DELIVERED',
  /** Delivered and invoiced in full, or closed by hand with what was delivered. */
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

/** What a customer ordered, and how much of it has been delivered and invoiced. */
@Entity({ name: 'sales_orders' })
@Unique('UQ_sales_orders_org_number', ['organizationId', 'orderNumber'])
@Index('IDX_sales_orders_org_status', ['organizationId', 'status', 'orderDate'])
@Check('CHK_sales_orders_status', `"status" IN ('CONFIRMED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CLOSED', 'CANCELLED')`)
export class SalesOrder {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_sales_orders' })
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_sales_orders_organization')
  organization?: TenantRef;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @IssuedAtBranch('FK_sales_orders_branch')
  branch?: BranchRef | null;

  @Column({ name: 'order_number', type: 'varchar', length: 32 })
  orderNumber: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @ManyToOne(() => Customer, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'customer_id', foreignKeyConstraintName: 'FK_sales_orders_customer' })
  customer?: Customer;

  @Column({ name: 'quote_id', type: 'uuid', nullable: true })
  quoteId: string | null;

  /** The customer's own purchase-order number, printed on the conduce and the invoice. */
  @Column({ name: 'customer_reference', type: 'varchar', length: 80, nullable: true })
  customerReference: string | null;

  @Column({ name: 'order_date', type: 'date' })
  orderDate: string;

  @Column({ name: 'expected_date', type: 'date', nullable: true })
  expectedDate: string | null;

  @Column({ name: 'currency_code', type: 'char', length: 3 })
  currencyCode: string;

  @Column({ type: 'varchar', length: 24, default: SalesOrderStatus.CONFIRMED })
  status: SalesOrderStatus;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0, transformer: numericTransformerNotNull })
  subtotal: number;

  @Column({ name: 'tax_total', type: 'numeric', precision: 18, scale: 2, default: 0, transformer: numericTransformerNotNull })
  taxTotal: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0, transformer: numericTransformerNotNull })
  total: number;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @OneToMany(() => SalesOrderLine, (line) => line.order, { cascade: true })
  lines: SalesOrderLine[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
