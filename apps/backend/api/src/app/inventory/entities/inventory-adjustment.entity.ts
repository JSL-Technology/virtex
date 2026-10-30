import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { Warehouse } from '../../supply-chain/entities/warehouse.entity';
import { Product } from './product.entity';
import { numericTransformer, numericTransformerNotNull } from '../../common/database/numeric.transformer';

export enum InventoryAdjustmentStatus {
  DRAFT = 'DRAFT',
  POSTED = 'POSTED',
  CANCELLED = 'CANCELLED',
}

/**
 * A change to what a warehouse holds that no purchase or sale explains: a count that disagrees
 * with the record, breakage, theft, samples, a corrected unit cost.
 *
 * ## Why a document and not a field on the product
 *
 * The product form used to carry an editable «stock» that, when changed, posted an adjustment with
 * the reason typed beside it. That is how no ERP works (MI01/MIGO 701, NetSuite Inventory
 * Adjustment, Odoo's physical inventory): the quantity on hand is a balance derived from
 * movements, and a hand-made change is a transaction with a number, a date, a warehouse, a person
 * and its own journal entry — reviewable before it is posted and traceable after.
 *
 * Lines are either counted (the quantity found; the change is computed against the warehouse's
 * balance when posting, so a count taken this morning is not wrong by this afternoon's sales) or a
 * stated change, and may carry a new unit cost, which revalues the product's whole stock.
 */
@Entity({ name: 'inventory_adjustments' })
@Index('UQ_inventory_adjustments_org_number', ['organizationId', 'number'], { unique: true })
@Index('IDX_inventory_adjustments_org_date', ['organizationId', 'date'])
export class InventoryAdjustment extends BaseEntity {
  @Column({ type: 'varchar', length: 40 })
  number: string;

  /** The day the stock changed — a calendar date, see `verify:date-columns`. */
  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => Warehouse, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'warehouse_id', foreignKeyConstraintName: 'FK_inventory_adjustments_warehouse' })
  warehouse?: Warehouse;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  /** Why: required, and repeated on the journal entry and the stock ledger. */
  @Column({ type: 'varchar', length: 255 })
  reason: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 16, default: InventoryAdjustmentStatus.DRAFT })
  status: InventoryAdjustmentStatus;

  /** The value moved, in the books' currency, once posted: positive a surplus, negative a loss. */
  @Column({ name: 'value_change', type: 'decimal', precision: 18, scale: 2, nullable: true, transformer: numericTransformer })
  valueChange: number | null;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @Column({ name: 'posted_by_user_id', type: 'uuid', nullable: true })
  postedByUserId: string | null;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt: Date | null;

  /** Who voided the draft, and when: a cancellation is a decision someone is answerable for. */
  @Column({ name: 'cancelled_by_user_id', type: 'uuid', nullable: true })
  cancelledByUserId: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  /**
   * The posted adjustment this one undoes, when it is a reversal.
   *
   * A posted adjustment is never edited: it is corrected by its mirror image, posted as a document
   * of its own (a number, a date, a reason, an entry), so the kardex and the ledger keep both the
   * mistake and its correction. The two point at each other.
   */
  @ManyToOne(() => InventoryAdjustment, { onDelete: 'NO ACTION', nullable: true })
  @JoinColumn({ name: 'reverses_adjustment_id', foreignKeyConstraintName: 'FK_inventory_adjustments_reverses' })
  reversesAdjustment?: InventoryAdjustment | null;

  @Column({ name: 'reverses_adjustment_id', type: 'uuid', nullable: true })
  reversesAdjustmentId: string | null;

  /** The reversal that undid this adjustment, once there is one. An adjustment is reversed once. */
  @Column({ name: 'reversed_by_adjustment_id', type: 'uuid', nullable: true })
  reversedByAdjustmentId: string | null;

  @OneToMany(() => InventoryAdjustmentLine, (line) => line.adjustment, { cascade: true })
  lines: InventoryAdjustmentLine[];

  // Tenant-owned: deleting the tenant deletes this row (see TenantOwned).
  @TenantOwned('FK_inventory_adjustments_organization')
  organization?: TenantRef;
}

@Entity({ name: 'inventory_adjustment_lines' })
export class InventoryAdjustmentLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => InventoryAdjustment, (adjustment) => adjustment.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'adjustment_id', foreignKeyConstraintName: 'FK_inventory_adjustment_lines_adjustment' })
  adjustment?: InventoryAdjustment;

  @Column({ name: 'adjustment_id', type: 'uuid' })
  adjustmentId: string;

  // A product with a posted adjustment keeps it: it is deactivated, never deleted.
  @ManyToOne(() => Product, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'FK_inventory_adjustment_lines_product' })
  product?: Product;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  /**
   * Where the line sits in the document, from 0. Lines used to come back ordered by their random
   * UUID, so a document saved as «screws, cable, boxes» reopened as «cable, screws, boxes».
   */
  @Column({ type: 'int', default: 0 })
  position: number;

  /**
   * What the warehouse held when the person counted — the figure the screen showed beside the count.
   *
   * A count is compared with the balance at posting. If something moved in between (a sale, another
   * adjustment), applying the count as typed would silently undo that movement; with this figure the
   * posting can tell, and refuses until someone decides (see `post`).
   */
  @Column({ name: 'expected_quantity', type: 'decimal', precision: 18, scale: 6, nullable: true, transformer: numericTransformer })
  expectedQuantity: number | null;

  /** What was counted. When set, the change is computed against the balance when posting. */
  @Column({ name: 'counted_quantity', type: 'decimal', precision: 18, scale: 6, nullable: true, transformer: numericTransformer })
  countedQuantity: number | null;

  /** The signed change; stated on a non-count line, filled in from the count when posting. */
  @Column({ name: 'quantity_change', type: 'decimal', precision: 18, scale: 6, default: 0, transformer: numericTransformerNotNull })
  quantityChange: number;

  /** The warehouse's balance when the adjustment was posted, kept to explain the change. */
  @Column({ name: 'quantity_before', type: 'decimal', precision: 18, scale: 6, nullable: true, transformer: numericTransformer })
  quantityBefore: number | null;

  /** The cost the movement was valued at: a surplus may state it; a shortfall leaves at average. */
  @Column({ name: 'unit_cost', type: 'decimal', precision: 18, scale: 6, nullable: true, transformer: numericTransformer })
  unitCost: number | null;

  /** A new unit cost for the product: revalues its whole stock, in every warehouse. */
  @Column({ name: 'new_unit_cost', type: 'decimal', precision: 18, scale: 6, nullable: true, transformer: numericTransformer })
  newUnitCost: number | null;

  /** The value this line moved once posted: `quantityValue + revaluationValue`. */
  @Column({ name: 'value_change', type: 'decimal', precision: 18, scale: 2, nullable: true, transformer: numericTransformer })
  valueChange: number | null;

  /**
   * The value of the quantity moved: positive a surplus, negative a shortfall.
   *
   * Kept apart from the revaluation because they are different events — a loss of goods and a
   * change in what goods are worth — and a single net figure let a revaluation hide a shrinkage.
   */
  @Column({ name: 'quantity_value', type: 'decimal', precision: 18, scale: 2, nullable: true, transformer: numericTransformer })
  quantityValue: number | null;

  /** The value a new unit cost added to (or took from) the product's whole stock. */
  @Column({ name: 'revaluation_value', type: 'decimal', precision: 18, scale: 2, nullable: true, transformer: numericTransformer })
  revaluationValue: number | null;
}
