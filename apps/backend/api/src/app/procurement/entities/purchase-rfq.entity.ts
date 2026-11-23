import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

export enum RfqStatus {
  DRAFT = 'DRAFT',
  /** Sent to the invited suppliers; their quotations are recorded against it. */
  SENT = 'SENT',
  /** One quotation won, and became a purchase order. */
  AWARDED = 'AWARDED',
  CANCELLED = 'CANCELLED',
}

/**
 * A request for quotation (audit 2026-11-07, CMP-15): what is needed, asked of several suppliers,
 * so the price on the order is one that was compared rather than the first one heard. The award
 * turns the chosen quotation into a draft order at its prices; choosing one that is not the
 * cheapest valid quotation takes a written reason.
 */
@Entity('purchase_rfqs')
@Index('UQ_purchase_rfqs_org_number', ['organizationId', 'number'], { unique: true })
@Index('IDX_purchase_rfqs_org_status', ['organizationId', 'status'])
@Check('CHK_purchase_rfqs_status', `"status" IN ('DRAFT', 'SENT', 'AWARDED', 'CANCELLED')`)
export class PurchaseRfq extends BaseEntity {
  @Column({ type: 'varchar', length: 40 })
  number: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 16, default: RfqStatus.DRAFT })
  status: RfqStatus;

  /** The approved requisition it sources, when there is one. */
  @Column({ name: 'requisition_id', type: 'uuid', nullable: true })
  requisitionId: string | null;

  @ManyToOne('PurchaseRequisition', { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'requisition_id', foreignKeyConstraintName: 'FK_purchase_rfqs_requisition' })
  requisition?: unknown;

  /** Quotations are compared in one currency: the RFQ's. */
  @Column({ name: 'currency_code', type: 'varchar', length: 3 })
  currencyCode: string;

  @Column({ name: 'response_due_date', type: 'date', nullable: true })
  responseDueDate: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'awarded_quote_id', type: 'uuid', nullable: true })
  awardedQuoteId: string | null;

  @Column({ name: 'awarded_order_id', type: 'uuid', nullable: true })
  awardedOrderId: string | null;

  @Column({ name: 'awarded_by_user_id', type: 'uuid', nullable: true })
  awardedByUserId: string | null;

  @Column({ name: 'awarded_at', type: 'timestamptz', nullable: true })
  awardedAt: Date | null;

  /** Why the winner is not the cheapest valid quotation; required in that case. */
  @Column({ name: 'award_reason', type: 'text', nullable: true })
  awardReason: string | null;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @OneToMany(() => PurchaseRfqLine, (line) => line.rfq, { cascade: true })
  lines: PurchaseRfqLine[];

  @OneToMany(() => PurchaseRfqSupplier, (invite) => invite.rfq, { cascade: true })
  suppliers: PurchaseRfqSupplier[];

  @TenantOwned('FK_purchase_rfqs_organization')
  organization?: TenantRef;
}

@Entity('purchase_rfq_lines')
@Index('IDX_purchase_rfq_lines_rfq', ['rfqId'])
@Check('CHK_purchase_rfq_lines_quantity', `"quantity" > 0`)
export class PurchaseRfqLine extends BaseEntity {
  @Column({ name: 'rfq_id', type: 'uuid' })
  rfqId: string;

  @ManyToOne(() => PurchaseRfq, (rfq) => rfq.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rfq_id', foreignKeyConstraintName: 'FK_purchase_rfq_lines_rfq' })
  rfq: PurchaseRfq;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @ManyToOne('Product', { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'FK_purchase_rfq_lines_product' })
  product?: unknown;

  @Column({ type: 'text' })
  description: string;

  @Column('decimal', { precision: 18, scale: 6, transformer: numericTransformerNotNull })
  quantity: number;

  @Column({ name: 'unit_of_measure', type: 'varchar', length: 16, default: 'UND' })
  unitOfMeasure: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @TenantOwned('FK_purchase_rfq_lines_organization')
  organization?: TenantRef;
}

/** A supplier asked to quote. Only an invited supplier's quotation is recorded. */
@Entity('purchase_rfq_suppliers')
@Index('UQ_purchase_rfq_suppliers', ['rfqId', 'supplierId'], { unique: true })
export class PurchaseRfqSupplier extends BaseEntity {
  @Column({ name: 'rfq_id', type: 'uuid' })
  rfqId: string;

  @ManyToOne(() => PurchaseRfq, (rfq) => rfq.suppliers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rfq_id', foreignKeyConstraintName: 'FK_purchase_rfq_suppliers_rfq' })
  rfq: PurchaseRfq;

  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId: string;

  @ManyToOne('Supplier', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'supplier_id', foreignKeyConstraintName: 'FK_purchase_rfq_suppliers_supplier' })
  supplier?: unknown;

  @TenantOwned('FK_purchase_rfq_suppliers_organization')
  organization?: TenantRef;
}
