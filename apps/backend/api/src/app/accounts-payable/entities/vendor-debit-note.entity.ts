
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
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
export class VendorDebitNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;


  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column()
  vendorBillId: string;

  @Column()
  reason: string;

  @Column('decimal', { precision: 10, scale: 2, transformer: numericTransformerNotNull })
  amount: number;


  @CreateDateColumn({ type: 'date' })
  date: Date;

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