import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { PurchaseRequisition } from './purchase-requisition.entity';
import { Product } from '../../inventory/entities/product.entity';

/**
 * What is actually being requested.
 *
 * The requisition carried a number, a requester, a status and a total, and nothing that said what
 * anybody wanted to buy. A requisition without lines is a number: it cannot be approved on its
 * merits, cannot be turned into a purchase order, and cannot be matched against what arrives.
 *
 * `productId` is optional on purpose. Half of what a business requisitions is not in its own
 * catalogue — a consultancy, a repair, a one-off part — and forcing a catalogue row for each of
 * them fills the product list with things nobody sells.
 */
@Entity('purchase_requisition_lines')
@Index('IDX_purchase_requisition_lines_requisition', ['requisitionId'])
export class PurchaseRequisitionLine extends BaseEntity {
  @Column({ name: 'requisition_id', type: 'uuid' })
  requisitionId: string;

  @ManyToOne(() => PurchaseRequisition, (requisition) => requisition.lines, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'requisition_id',
    foreignKeyConstraintName: 'FK_purchase_requisition_lines_requisition',
  })
  requisition: PurchaseRequisition;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'FK_purchase_requisition_lines_product',
  })
  product: Product | null;

  /** What the requester asked for, in their own words. Required even when a product is named. */
  @Column({ type: 'text' })
  description: string;

  @Column('decimal', {
    precision: 18,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  quantity: number;

  /** What the requester expects it to cost. An estimate, not a price: nobody has quoted yet. */
  @Column('decimal', {
    name: 'estimated_unit_price',
    precision: 18,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  estimatedUnitPrice: number;

  @Column({ name: 'unit_of_measure', type: 'varchar', length: 16, default: 'UND' })
  unitOfMeasure: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}
