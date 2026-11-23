import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { numericTransformer, numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

export enum PurchaseAgreementStatus {
  DRAFT = 'DRAFT',
  /** In force: orders can be released against it inside its validity. */
  ACTIVE = 'ACTIVE',
  /** Ended early, with a reason; what was released stays. */
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

/**
 * A purchase agreement, or blanket order (audit 2026-11-07, CMP-15): prices agreed with one
 * supplier for a period, with a ceiling per line and, optionally, on the whole. Each release is an
 * ordinary purchase order at the agreed prices, approved and received as any other.
 *
 * What has been used is never a counter that can drift: it is the sum of the release orders that
 * still stand — the quantity ordered, or what was received of an order closed short — read under a
 * lock on the agreement, so two releases at once cannot both take the last units.
 */
@Entity('purchase_agreements')
@Index('UQ_purchase_agreements_org_number', ['organizationId', 'number'], { unique: true })
@Index('IDX_purchase_agreements_org_status', ['organizationId', 'status'])
@Check('CHK_purchase_agreements_status', `"status" IN ('DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED')`)
@Check('CHK_purchase_agreements_validity', `"valid_to" >= "valid_from"`)
@Check('CHK_purchase_agreements_max_amount', `"max_amount" IS NULL OR "max_amount" > 0`)
export class PurchaseAgreement extends BaseEntity {
  @Column({ type: 'varchar', length: 40 })
  number: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId: string;

  @ManyToOne('Supplier', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'supplier_id', foreignKeyConstraintName: 'FK_purchase_agreements_supplier' })
  supplier?: unknown;

  @Column({ type: 'varchar', length: 16, default: PurchaseAgreementStatus.DRAFT })
  status: PurchaseAgreementStatus;

  @Column({ name: 'valid_from', type: 'date' })
  validFrom: string;

  @Column({ name: 'valid_to', type: 'date' })
  validTo: string;

  @Column({ name: 'currency_code', type: 'varchar', length: 3 })
  currencyCode: string;

  /** Ceiling on everything released, before tax. Null: only the lines' ceilings apply. */
  @Column('decimal', { name: 'max_amount', precision: 18, scale: 2, nullable: true, transformer: numericTransformer })
  maxAmount: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @Column({ name: 'activated_by_user_id', type: 'uuid', nullable: true })
  activatedByUserId: string | null;

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ name: 'close_reason', type: 'text', nullable: true })
  closeReason: string | null;

  @OneToMany(() => PurchaseAgreementLine, (line) => line.agreement, { cascade: true })
  lines: PurchaseAgreementLine[];

  @TenantOwned('FK_purchase_agreements_organization')
  organization?: TenantRef;
}

@Entity('purchase_agreement_lines')
@Index('IDX_purchase_agreement_lines_agreement', ['agreementId'])
@Check('CHK_purchase_agreement_lines_amounts', `"unit_price" >= 0 AND "tax_rate" >= 0 AND "tax_rate" <= 1 AND ("max_quantity" IS NULL OR "max_quantity" > 0)`)
export class PurchaseAgreementLine extends BaseEntity {
  @Column({ name: 'agreement_id', type: 'uuid' })
  agreementId: string;

  @ManyToOne(() => PurchaseAgreement, (agreement) => agreement.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agreement_id', foreignKeyConstraintName: 'FK_purchase_agreement_lines_agreement' })
  agreement: PurchaseAgreement;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @ManyToOne('Product', { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'FK_purchase_agreement_lines_product' })
  product?: unknown;

  @Column({ type: 'text' })
  description: string;

  @Column('decimal', { name: 'unit_price', precision: 18, scale: 6, transformer: numericTransformerNotNull })
  unitPrice: number;

  @Column('decimal', { name: 'tax_rate', precision: 9, scale: 6, default: 0, transformer: numericTransformerNotNull })
  taxRate: number;

  /** Ceiling over the whole agreement. Null: no ceiling on this line. */
  @Column('decimal', { name: 'max_quantity', precision: 18, scale: 6, nullable: true, transformer: numericTransformer })
  maxQuantity: number | null;

  @Column({ name: 'unit_of_measure', type: 'varchar', length: 16, default: 'UND' })
  unitOfMeasure: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @TenantOwned('FK_purchase_agreement_lines_organization')
  organization?: TenantRef;
}
