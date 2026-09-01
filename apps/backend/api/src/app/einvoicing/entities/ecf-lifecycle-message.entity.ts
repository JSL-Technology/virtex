import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  VersionColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { EcfStatus } from './ecf-submission.entity';
import { NcfType } from '../../compliance/entities/ncf-sequence.entity';

/**
 * The two DGII messages that are part of the e-CF cycle but are not comprobantes themselves.
 *
 * Neither existed. The transport service could send both — `sendCommercialApproval` and
 * `voidSequenceRange` were written, and their endpoints resolved in configuration — but nothing
 * built their XML, nothing signed them and no route reached them, so a taxpayer using this product
 * could not complete either obligation.
 */
export enum EcfMessageKind {
  /**
   * Aprobación Comercial (ACECF). The BUYER's verdict on a comprobante a supplier issued to them.
   * Norma 01-2020 requires the receiver of an e-CF 31, 33, 34, 41, 44, 45 or 47 to answer it within
   * three business days; silence is treated as acceptance, but a dispute that is never registered
   * cannot later be argued.
   */
  COMMERCIAL_APPROVAL = 'COMMERCIAL_APPROVAL',
  /**
   * Anulación de e-NCF (ANECF). Declares authorized numbers that will never be used. Without it the
   * DGII sees an unexplained gap in the taxpayer's sequence, which is what an audit looks for.
   */
  SEQUENCE_VOID = 'SEQUENCE_VOID',
}

/** DGII verdict codes for a commercial approval. */
export enum CommercialApprovalVerdict {
  APPROVED = '1',
  REJECTED = '2',
}

@Entity({ name: 'ecf_lifecycle_messages' })
@Index('IDX_ecf_lifecycle_org_kind', ['organizationId', 'kind'])
// A tenant answers a given supplier comprobante once. Partial, because the void rows carry no NCF
// and two voids of different ranges are perfectly legitimate.
@Index('UQ_ecf_lifecycle_approval', ['organizationId', 'issuerRnc', 'ncf'], {
  unique: true,
  where: `"kind" = 'COMMERCIAL_APPROVAL'`,
})
export class EcfLifecycleMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'enum', enum: EcfMessageKind })
  kind: EcfMessageKind;

  // ── Commercial approval ────────────────────────────────────────────────────

  /** RNC of the supplier that issued the comprobante being answered. */
  @Column({ name: 'issuer_rnc', type: 'varchar', length: 16, nullable: true })
  issuerRnc?: string | null;

  /** The supplier's e-NCF being answered. */
  @Column({ name: 'ncf', type: 'varchar', length: 19, nullable: true })
  ncf?: string | null;

  /** Issue date of the answered comprobante, as the supplier stated it (`YYYY-MM-DD`). */
  @Column({ name: 'document_date', type: 'date', nullable: true })
  documentDate?: string | null;

  /** Total of the answered comprobante. It must match the supplier's to the cent. */
  @Column({ name: 'document_total', type: 'numeric', precision: 18, scale: 2, nullable: true })
  documentTotal?: string | null;

  @Column({ name: 'verdict', type: 'enum', enum: CommercialApprovalVerdict, nullable: true })
  verdict?: CommercialApprovalVerdict | null;

  /** Why the comprobante was rejected. Mandatory when the verdict is a rejection. */
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string | null;

  // ── Sequence void ──────────────────────────────────────────────────────────

  @Column({ name: 'ecf_type', type: 'enum', enum: NcfType, nullable: true })
  ecfType?: NcfType | null;

  @Column({ name: 'sequence_from', type: 'bigint', nullable: true })
  sequenceFrom?: string | null;

  @Column({ name: 'sequence_to', type: 'bigint', nullable: true })
  sequenceTo?: string | null;

  // ── Transmission ───────────────────────────────────────────────────────────

  @Column({ name: 'signed_xml', type: 'text', nullable: true })
  signedXml?: string | null;

  @Column({ name: 'track_id', type: 'varchar', nullable: true })
  trackId?: string | null;

  @Column({ type: 'enum', enum: EcfStatus, default: EcfStatus.PENDING })
  status: EcfStatus;

  @Column({ name: 'dgii_response', type: 'jsonb', nullable: true })
  dgiiResponse?: unknown;

  @Column({ name: 'messages', type: 'jsonb', nullable: true })
  messages?: string[] | null;

  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt?: Date | null;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @VersionColumn({ default: 1 })
  version: number;
}
