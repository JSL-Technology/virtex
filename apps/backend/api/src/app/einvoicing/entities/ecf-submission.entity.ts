import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, VersionColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';

/**
 * Lifecycle of a single e-CF as it moves from generation to a final DGII verdict.
 *
 * DGII acceptance is asynchronous: we sign and transmit, receive a `trackId`, and later poll the
 * status endpoint until the comprobante is Aceptado / Aceptado Condicional / Rechazado. Every step
 * and the raw DGII payloads are persisted so the state is auditable and reprocessable.
 */
export enum EcfStatus {
  /** Row created, e-NCF assigned, not yet built/signed. */
  PENDING = 'PENDING',
  /** XML built and XMLDSig signature applied locally. */
  SIGNED = 'SIGNED',
  /** Transmitted to the DGII reception endpoint; `trackId` obtained; awaiting verdict. */
  SENT = 'SENT',
  /** DGII final verdict: Aceptado. */
  ACCEPTED = 'ACCEPTED',
  /** DGII final verdict: Aceptado Condicional (accepted with observations). */
  ACCEPTED_WITH_OBSERVATIONS = 'ACCEPTED_WITH_OBSERVATIONS',
  /** DGII final verdict: Rechazado. */
  REJECTED = 'REJECTED',
  /** Issued under contingency because the DGII was unreachable; must be transmitted later. */
  CONTINGENCY = 'CONTINGENCY',
  /** Local build/sign/transport failure; retriable. */
  ERROR = 'ERROR',
}

@Entity({ name: 'ecf_submissions' })
@Index('IDX_ecf_submissions_org_status', ['organizationId', 'status'])
@Index('UQ_ecf_submissions_invoice', ['invoiceId'], { unique: true })
export class EcfSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * `uuid`, matching `organizations.id`, with a foreign key.
   *
   * Twenty tables held the tenant reference as `character varying` while the column it points at
   * is a uuid. A join between them was a type error PostgreSQL refused outright, and a row whose
   * organization had been deleted was perfectly storable.
   */
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  /**
   * The document this submission belongs to.
   *
   * There was no foreign key: a submission could reference an invoice that did not exist, and
   * discarding a draft left its e-CF row orphaned.
   */
  @ManyToOne(() => Invoice, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  /** The e-NCF assigned to this document (e.g. `E310000000001`). */
  @Column({ name: 'ncf' })
  ncf: string;

  /** DGII document type code carried by the e-NCF (`31`, `32`, `34`, …). */
  @Column({ name: 'ecf_type', length: 2 })
  ecfType: string;

  /**
   * Código de seguridad: the first 6 hex chars of the XMLDSig SignatureValue digest. It is embedded
   * in the QR URL of the representación impresa so the DGII portal can resolve the document.
   */
  @Column({ name: 'security_code', nullable: true })
  securityCode?: string;

  /** Tracking id returned by the DGII reception endpoint. */
  @Column({ name: 'track_id', nullable: true })
  trackId?: string;

  /** URL encoded in the QR of the representación impresa. */
  @Column({ name: 'qr_url', type: 'text', nullable: true })
  qrUrl?: string;

  /** The signed e-CF XML actually transmitted. */
  @Column({ name: 'signed_xml', type: 'text', nullable: true })
  signedXml?: string;

  @Column({ type: 'enum', enum: EcfStatus, default: EcfStatus.PENDING })
  status: EcfStatus;

  /** Raw DGII responses (reception + status polls) for audit. */
  @Column({ name: 'dgii_response', type: 'jsonb', nullable: true })
  dgiiResponse?: unknown;

  /** Human-readable messages/observations returned by the DGII. */
  @Column({ name: 'messages', type: 'jsonb', nullable: true })
  messages?: string[];

  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt?: Date;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt?: Date;

  // `timestamptz`, matching the migration. The entity declared `timestamp` without a zone while the
  // migration created `timestamptz`, which is what `check:schema-drift` — a CI gate — reported on
  // every build. For an auditable fiscal record in a product sold from Mexico to Argentina, a
  // timestamp without a zone is a defect in itself, not only a drift.
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @VersionColumn({ default: 1 })
  version: number;
}
