
import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { VendorBill } from './vendor-bill.entity';
import { BranchRef, IssuedAtBranch } from '../../organizations/contracts/branch.contract';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

/**
 * A debit note is a posted document: it reduced what the supplier is owed and booked an entry when
 * it was issued. From then on it is corrected the way every posted document is — voided, with a
 * reversing entry, a reason, a date and an author — never edited or deleted. Editing its amount
 * used to leave the entry and the bill's balance saying something else; deleting it left the entry
 * in the ledger for a document that no longer existed.
 */
export enum VendorDebitNoteStatus {
  POSTED = 'POSTED',
  VOIDED = 'VOIDED',
}

@Entity()
@Index('UQ_vendor_debit_note_org_number', ['organizationId', 'number'], { unique: true })
@Index('IDX_vendor_debit_note_bill', ['vendorBillId'])
@Index('IDX_vendor_debit_note_org_date', ['organizationId', 'date'])
@Index('IDX_vendor_debit_note_org_branch', ['organizationId', 'branchId'])
@Check('CHK_vendor_debit_note_tax', `"tax_amount" >= 0 AND "tax_amount" < "amount"`)
export class VendorDebitNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** `ND-2026-000042`. */
  @Column({ type: 'varchar', length: 40 })
  number: string;

  // A note outlives nothing it refers to: the bill cannot be deleted while a note points at it.
  @ManyToOne('VendorBill', { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'vendor_bill_id', foreignKeyConstraintName: 'FK_vendor_debit_note_vendor_bill' })
  vendorBill?: VendorBill;

  @Column({ name: 'vendor_bill_id', type: 'uuid' })
  vendorBillId: string;

  /** The branch of the bill it reduces — see `IssuedAtBranch`. */
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @IssuedAtBranch('FK_vendor_debit_note_branch')
  branch?: BranchRef | null;

  @Column({ type: 'varchar', length: 500 })
  reason: string;

  /**
   * The supplier's own document for it, when there is one — in the Dominican Republic the credit
   * note's NCF (type 04 / e-CF 34), which the 606 report pairs with the bill it modifies.
   */
  @Column({ type: 'varchar', length: 19, nullable: true })
  ncf: string | null;

  /** What the supplier is owed less, in the bill's currency, tax included. */
  @Column('decimal', { precision: 18, scale: 2, transformer: numericTransformerNotNull })
  amount: number;

  /** The part of `amount` that is input tax given back: it reverses the tax credit, not the cost. */
  @Column('decimal', { name: 'tax_amount', precision: 18, scale: 2, default: 0, transformer: numericTransformerNotNull })
  taxAmount: number;

  /** Where the rest went: the expense or inventory account the bill had charged. */
  @Column({ name: 'expense_account_id', type: 'uuid', nullable: true })
  expenseAccountId: string | null;

  /**
   * The day the note takes effect — a calendar date, see `verify:date-columns`. No default: the
   * service sets it, from the request or the company's own today, never the server's UTC date.
   */
  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'varchar', length: 16, default: VendorDebitNoteStatus.POSTED })
  status: VendorDebitNoteStatus;

  /** The entry it posted. Null only for notes issued before this was recorded. */
  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @Column({ name: 'reversal_journal_entry_id', type: 'uuid', nullable: true })
  reversalJournalEntryId: string | null;

  @Column({ name: 'void_reason', type: 'text', nullable: true })
  voidReason: string | null;

  @Column({ name: 'voided_at', type: 'timestamptz', nullable: true })
  voidedAt: Date | null;

  @Column({ name: 'voided_by_user_id', type: 'uuid', nullable: true })
  voidedByUserId: string | null;

  // Tenant-owned: deleting the tenant deletes this row (see TenantOwned).
  @TenantOwned('FK_vendor_debit_note_organization')
  organization?: TenantRef;
}