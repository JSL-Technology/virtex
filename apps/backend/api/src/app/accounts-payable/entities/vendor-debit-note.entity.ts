
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

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

  // Tenant-owned: deleting the tenant deletes this row (see TenantOwned).
  @TenantOwned('FK_vendor_debit_note_organization')
  organization?: TenantRef;
}