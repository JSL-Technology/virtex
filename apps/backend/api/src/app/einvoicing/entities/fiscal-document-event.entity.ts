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
import { FiscalSubmissionStatus } from './fiscal-submission.entity';

/**
 * Something a taxpayer tells its authority ABOUT documents, rather than a document itself.
 *
 * Every electronic-invoicing regime has these, and they are not the same thing as a submission: a
 * submission says where one document stands, an event is a declaration that refers to documents —
 * one the counterparty issued, or numbers that will never be used.
 *
 * | Event | Dominican Republic | Elsewhere |
 * |---|---|---|
 * | A counterparty's verdict on a document issued to them | Aprobación Comercial (ACECF) | Manifestação do destinatário (BR), acuse de recibo y aceptación (CO), aceptación de cancelación (MX) |
 * | Authorised numbers that will never be used | Anulación de e-NCF (ANECF) | Comunicación de baja (PE), inutilização de numeração (BR) |
 *
 * The table was `ecf_lifecycle_messages`, with the DGII's vocabulary in its columns (`issuer_rnc`,
 * `ncf`, `ecf_type`, `signed_xml`, `track_id`, `dgii_response`) and the DGII's own codes as the
 * values of `verdict` (`1`, `2`). The event is the same fact in every market, so the columns say
 * what it is and the authority's codes are written by the market that owns them
 * (`counterpartyVerdictCodeFor`). Which regime an event belongs to is recorded, as it is for a
 * submission.
 */
export enum FiscalDocumentEventKind {
  /**
   * The verdict of whoever RECEIVED a document on the document their counterparty issued.
   *
   * In the Dominican Republic, Norma 01-2020 requires the receiver of an e-CF 31, 33, 34, 41, 44,
   * 45 or 47 to answer within three business days; silence is treated as acceptance, but a dispute
   * that is never registered cannot later be argued.
   */
  COUNTERPARTY_VERDICT = 'COUNTERPARTY_VERDICT',
  /**
   * Authorised numbers that will never be used. Without this declaration the authority sees an
   * unexplained gap in the taxpayer's sequence, which is what an audit looks for.
   */
  NUMBER_RANGE_VOID = 'NUMBER_RANGE_VOID',
}

/**
 * What the receiver answered, in the product's own terms.
 *
 * The column held the DGII's codes (`1` accepted, `2` rejected) for every market. Each authority
 * numbers them differently and the market writes its own code when the event is built.
 */
export enum CounterpartyVerdict {
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

@Entity({ name: 'fiscal_document_events' })
@Index('IDX_fiscal_document_events_org_kind', ['organizationId', 'kind'])
// A tenant answers a given counterparty document once. Partial, because a void carries no document
// number and two voids of different ranges are perfectly legitimate.
@Index('UQ_fiscal_document_events_verdict', ['organizationId', 'counterpartyTaxId', 'documentNumber'], {
  unique: true,
  where: `"kind" = 'COUNTERPARTY_VERDICT'`,
})
export class FiscalDocumentEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  /** ISO 3166-1 alpha-2 of the market whose authority this event is for. */
  @Column({ name: 'country_code', type: 'varchar', length: 2 })
  countryCode: string;

  /** The regime's own name, as the authority calls it: `DGII e-CF`, `NFe 4.0`… */
  @Column({ type: 'varchar', length: 32 })
  regime: string;

  @Column({ type: 'enum', enum: FiscalDocumentEventKind })
  kind: FiscalDocumentEventKind;

  // ── A counterparty's verdict ───────────────────────────────────────────────

  /** The identifier of the party that issued the document being answered, digits only. */
  @Column({ name: 'counterparty_tax_id', type: 'varchar', length: 32, nullable: true })
  counterpartyTaxId?: string | null;

  /** The number on the document being answered, as its authority assigned it. */
  @Column({ name: 'document_number', type: 'varchar', length: 64, nullable: true })
  documentNumber?: string | null;

  /** Issue date of the answered document, as the issuer stated it (`YYYY-MM-DD`). */
  @Column({ name: 'document_date', type: 'date', nullable: true })
  documentDate?: string | null;

  /** Total of the answered document. It must match the issuer's to the cent. */
  @Column({ name: 'document_total', type: 'numeric', precision: 18, scale: 2, nullable: true })
  documentTotal?: string | null;

  @Column({ name: 'verdict', type: 'enum', enum: CounterpartyVerdict, nullable: true })
  verdict?: CounterpartyVerdict | null;

  /** Why the document was rejected. Mandatory when the verdict is a rejection. */
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string | null;

  // ── Numbers that will never be used ────────────────────────────────────────

  /**
   * The document type whose numbers are being voided, as the market's catalogue names it.
   *
   * A `varchar` rather than a PostgreSQL enum, for the same reason as
   * `fiscal_document_ranges.document_type`: the schema should not have to change for a market to
   * exist. See that column for the full account.
   */
  @Column({ name: 'document_type', type: 'varchar', length: 8, nullable: true })
  documentType?: string | null;

  @Column({ name: 'sequence_from', type: 'bigint', nullable: true })
  sequenceFrom?: string | null;

  @Column({ name: 'sequence_to', type: 'bigint', nullable: true })
  sequenceTo?: string | null;

  // ── Transmission ───────────────────────────────────────────────────────────

  /** The sealed declaration as sent: the evidence of what was declared. */
  @Column({ name: 'payload', type: 'text', nullable: true })
  payload?: string | null;

  /** The authority's handle for it: trackId, protocolo, número de autorización. */
  @Column({ name: 'tracking_id', type: 'varchar', length: 128, nullable: true })
  trackingId?: string | null;

  /**
   * The same lifecycle as a document's own submission, and the same values, under this table's own
   * PostgreSQL type: TypeORM models one enum type per column, and two entities sharing one type
   * read as schema drift on every build.
   */
  @Column({ type: 'enum', enum: FiscalSubmissionStatus, default: FiscalSubmissionStatus.PENDING })
  status: FiscalSubmissionStatus;

  @Column({ name: 'response', type: 'jsonb', nullable: true })
  response?: unknown;

  /** Every message the authority sent, verbatim. */
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
