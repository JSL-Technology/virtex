import { Check, Column, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

export enum ReceivedEcfStatus {
  /** Acknowledged (ARECF «recibido»), awaiting the tenant's commercial verdict. */
  RECEIVED = 'RECEIVED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/**
 * An e-CF a supplier sent to this tenant's reception service.
 *
 * Kept whole — the XML as received is the legal document, and the 606 and any dispute are argued
 * from it — with the fields the inbox and the purchase register need lifted out of it.
 */
@Entity({ name: 'ecf_received_documents' })
@Unique('UQ_ecf_received_documents_org_issuer_ncf', ['organizationId', 'issuerRnc', 'ncf'])
@Check('CHK_ecf_received_documents_status', `"status" IN ('RECEIVED', 'APPROVED', 'REJECTED')`)
@Index('IDX_ecf_received_documents_org_status', ['organizationId', 'status', 'receivedAt'])
export class EcfReceivedDocument {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_ecf_received_documents' })
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ecf_received_documents_organization')
  organization?: TenantRef;

  @Column({ name: 'issuer_rnc', type: 'varchar', length: 16 })
  issuerRnc: string;

  @Column({ name: 'issuer_name', type: 'varchar', length: 255, nullable: true })
  issuerName: string | null;

  @Column({ name: 'ncf', type: 'varchar', length: 19 })
  ncf: string;

  /** `31`, `33`, `34`… as the e-CF's `TipoeCF` states it. */
  @Column({ name: 'ecf_type', type: 'varchar', length: 3 })
  ecfType: string;

  @Column({ name: 'issue_date', type: 'date', nullable: true })
  issueDate: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, transformer: numericTransformerNotNull, default: 0 })
  total: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, transformer: numericTransformerNotNull, default: 0 })
  itbis: number;

  @Column({ name: 'currency_code', type: 'char', length: 3, default: 'DOP' })
  currencyCode: string;

  @Column({ type: 'text' })
  xml: string;

  /** Whether the XMLDSig signature verified against the certificate it carries. */
  @Column({ name: 'signature_valid', type: 'boolean', default: false })
  signatureValid: boolean;

  /** The signed ARECF returned to the supplier. */
  @Column({ name: 'ack_xml', type: 'text', nullable: true })
  ackXml: string | null;

  @Column({ type: 'varchar', length: 16, default: ReceivedEcfStatus.RECEIVED })
  status: ReceivedEcfStatus;

  /** The ACECF this tenant sent about it (`ecf_lifecycle_messages`). */
  @Column({ name: 'commercial_message_id', type: 'uuid', nullable: true })
  commercialMessageId: string | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  /** The supplier bill it was booked as, once it was. */
  @Column({ name: 'vendor_bill_id', type: 'uuid', nullable: true })
  vendorBillId: string | null;

  @Column({ name: 'received_at', type: 'timestamptz', default: () => 'now()' })
  receivedAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
