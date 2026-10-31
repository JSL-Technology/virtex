import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { BranchRef, IssuedAtBranch } from '../../organizations/contracts/branch.contract';
import { Customer } from '../../customers/entities/customer.entity';
import { SalesOrder } from './sales-order.entity';
import { DeliveryNoteLine } from './delivery-note-line.entity';

export enum DeliveryNoteStatus {
  /** The goods left: stock moved, awaiting its invoice. */
  POSTED = 'POSTED',
  INVOICED = 'INVOICED',
  /** Undone before invoicing: the goods came back. */
  VOIDED = 'VOIDED',
}

/** The conduce: goods delivered against a sales order, signed by whoever received them. */
@Entity({ name: 'delivery_notes' })
@Unique('UQ_delivery_notes_org_number', ['organizationId', 'number'])
@Index('IDX_delivery_notes_org_order', ['organizationId', 'orderId'])
@Check('CHK_delivery_notes_status', `"status" IN ('POSTED', 'INVOICED', 'VOIDED')`)
export class DeliveryNote {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_delivery_notes' })
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_delivery_notes_organization')
  organization?: TenantRef;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @IssuedAtBranch('FK_delivery_notes_branch')
  branch?: BranchRef | null;

  @Column({ type: 'varchar', length: 32 })
  number: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => SalesOrder, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'order_id', foreignKeyConstraintName: 'FK_delivery_notes_order' })
  order?: SalesOrder;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @ManyToOne(() => Customer, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'customer_id', foreignKeyConstraintName: 'FK_delivery_notes_customer' })
  customer?: Customer;

  @Column({ name: 'delivery_date', type: 'date' })
  deliveryDate: string;

  @Column({ type: 'varchar', length: 16, default: DeliveryNoteStatus.POSTED })
  status: DeliveryNoteStatus;

  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoiceId: string | null;

  @Column({ name: 'driver_name', type: 'varchar', length: 120, nullable: true })
  driverName: string | null;

  @Column({ name: 'vehicle_plate', type: 'varchar', length: 20, nullable: true })
  vehiclePlate: string | null;

  @Column({ name: 'delivery_address', type: 'text', nullable: true })
  deliveryAddress: string | null;

  @Column({ name: 'received_by', type: 'varchar', length: 120, nullable: true })
  receivedBy: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'void_reason', type: 'text', nullable: true })
  voidReason: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @OneToMany(() => DeliveryNoteLine, (line) => line.deliveryNote, { cascade: true })
  lines: DeliveryNoteLine[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
