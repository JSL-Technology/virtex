import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import type { VendorBill } from './vendor-bill.entity';

/**
 * The supplier's document behind a bill — evidence the DGII can ask for. Staged with no bill while
 * the form is being filled from it, and claimed by the bill when the bill is saved.
 */
@Entity({ name: 'vendor_bill_attachments' })
@Index('IDX_vendor_bill_attachments_org_bill', ['organizationId', 'vendorBillId'])
@Index('IDX_vendor_bill_attachments_org_sha256', ['organizationId', 'sha256'])
export class VendorBillAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_vendor_bill_attachments_organization')
  organization?: TenantRef;

  @Column({ name: 'vendor_bill_id', type: 'uuid', nullable: true })
  vendorBillId: string | null;

  @ManyToOne('VendorBill', { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'vendor_bill_id', foreignKeyConstraintName: 'FK_vendor_bill_attachments_bill' })
  vendorBill?: VendorBill | null;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType: string;

  @Column({ name: 'file_size', type: 'integer' })
  fileSize: number;

  @Column({ name: 'storage_key', type: 'varchar', length: 500 })
  storageKey: string;

  @Column({ type: 'char', length: 64 })
  sha256: string;

  @Column({ name: 'uploaded_by_user_id', type: 'uuid', nullable: true })
  uploadedByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
