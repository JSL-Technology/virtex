import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

/** How one receipt line took its share of a landed cost. */
export interface LandedCostAllocationLine {
  receiptId: string;
  productId: string;
  description: string;
  quantity: number;
  /** The line's share of the cost, in the books' currency. */
  share: number;
  /** The part carried into the average cost of the units still on hand. */
  absorbed: number;
  /** How many units carried `absorbed` — the ones a void must still find on hand. */
  units: number;
  /** The part on units already sold, booked to the cost of sales. */
  toCostOfSales: number;
}

export enum LandedCostAllocationStatus {
  POSTED = 'POSTED',
  VOID = 'VOID',
}

/**
 * A landed cost — freight, customs, insurance — applied to goods already received (audit
 * 2026-11-07, CMP-21).
 *
 * `landed_costs` was a catalogue whose allocation method nothing ever applied: no receipt and no
 * freight bill revalued stock, so an importer could not cost its goods. This document takes an
 * amount, the receipts it belongs to and a catalogue entry (method and the account it is credited
 * to), prorates it over the receipts' stocked lines, raises the weighted-average cost of the units
 * still on hand, books the part on units already sold to the cost of sales, and posts
 * Dr Inventory / Dr Cost of sales / Cr the catalogue's account. A void gives it all back.
 */
@Entity({ name: 'landed_cost_allocations' })
@Index('IDX_landed_cost_allocations_org', ['organizationId', 'date'])
@Check('CHK_landed_cost_allocations_amount', `"amount" > 0`)
export class LandedCostAllocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  // By name: the entity is the organizations module's (verify:boundaries).
  @ManyToOne('Organization', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_landed_cost_allocations_organization' })
  organization?: unknown;

  @Column({ name: 'landed_cost_id', type: 'uuid' })
  landedCostId: string;

  // By name: the catalogue is the supply-chain module's.
  @ManyToOne('LandedCost', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'landed_cost_id', foreignKeyConstraintName: 'FK_landed_cost_allocations_landed_cost' })
  landedCost?: unknown;

  @Column({ type: 'date' })
  date: string;

  /** In the books' currency. */
  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount: string;

  @Column({ name: 'allocation_method', type: 'varchar', length: 10 })
  allocationMethod: string;

  @Column({ name: 'receipt_ids', type: 'uuid', array: true })
  receiptIds: string[];

  /** The freight or customs document this cost comes from, as the supplier numbered it. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  reference: string | null;

  @Column({ type: 'jsonb' })
  lines: LandedCostAllocationLine[];

  @Column({ type: 'varchar', length: 8, default: LandedCostAllocationStatus.POSTED })
  status: LandedCostAllocationStatus;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @Column({ name: 'reversal_journal_entry_id', type: 'uuid', nullable: true })
  reversalJournalEntryId: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
