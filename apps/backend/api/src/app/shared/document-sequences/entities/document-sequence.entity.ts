import { Organization } from '../../../organizations/entities/organization.entity';
import { Entity, PrimaryGeneratedColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';

export enum DocumentType {
  CUSTOMER_INVOICE = 'CUSTOMER_INVOICE',
  CREDIT_NOTE = 'CREDIT_NOTE',
  VENDOR_BILL = 'VENDOR_BILL',
  JOURNAL_ENTRY = 'JOURNAL_ENTRY',
}

@Entity({ name: 'document_sequences' })
@Index(['organizationId', 'type'], { unique: true })
export class DocumentSequence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'enum', enum: DocumentType })
  type: DocumentType;

  @Column({ length: 20 })
  prefix: string;

  @Column({ type: 'bigint', default: 1 })
  nextNumber: number;

  @Column({ default: false })
  isElectronic: boolean;
}