import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Invoice } from '../../invoices/entities/invoice.entity';

/**
 * Where one electronic document stands with its authority, in every market that has one — the
 * Dominican e-CF included, which kept its own table (`ecf_submissions`) until the regime became an
 * adapter like the others (docs/ARQUITECTURA_MERCADOS.md, fase 3).
 *
 *  - `PENDING`: committed with the invoice, not yet attempted.
 *  - `NOT_CONFIGURED`: built and sealed where possible, not sent — the tenant has no certificate
 *    or transmission configured, or this environment has fiscal-authority calls disabled. Fixed
 *    in settings, then retried; never confused with a rejection.
 *  - `SENT`: the authority received it and has not answered yet (or the exchange's outcome is
 *    unknown): the reconciler asks again. Never resent blindly — that is how one sale ends with two
 *    fiscal documents.
 *  - `CONTINGENCY`: issued while the authority could not be reached. The sale happened and the
 *    number is spent, so the document is owed and retried; a fault that outlives a day of retries
 *    becomes an `ERROR` the tenant sees instead of being retried forever in silence.
 *  - `ACCEPTED` / `ACCEPTED_WITH_OBSERVATIONS` / `REJECTED`: the authority's verdict, with its
 *    messages verbatim. The middle one is its own verdict where the authority has one («Aceptado
 *    Condicional»): the document stands and the observations are the taxpayer's to read.
 *  - `ERROR`: the step on our side failed (build, seal), or the document is one the tenant has to
 *    correct; retried with backoff.
 */
export enum FiscalSubmissionStatus {
  PENDING = 'PENDING',
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  SENT = 'SENT',
  CONTINGENCY = 'CONTINGENCY',
  ACCEPTED = 'ACCEPTED',
  ACCEPTED_WITH_OBSERVATIONS = 'ACCEPTED_WITH_OBSERVATIONS',
  REJECTED = 'REJECTED',
  ERROR = 'ERROR',
}

@Entity({ name: 'fiscal_submissions' })
@Index('UQ_fiscal_submissions_invoice', ['invoiceId'], { unique: true })
@Index('IDX_fiscal_submissions_due', ['organizationId', 'status', 'nextAttemptAt'])
@Check('CHK_fiscal_submissions_attempts', `"attempts" >= 0`)
export class FiscalSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  // By name: the entity is the organizations module's (verify:boundaries).
  @ManyToOne('Organization', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_fiscal_submissions_organization' })
  organization?: unknown;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  /** RESTRICT: a fiscal document's transmission record outlives nothing it describes. */
  @ManyToOne(() => Invoice, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invoice_id', foreignKeyConstraintName: 'FK_fiscal_submissions_invoice' })
  invoice?: Invoice;

  @Column({ name: 'country_code', type: 'varchar', length: 2 })
  countryCode: string;

  /** The regime's own name: `CFDI 4.0`, `DIAN UBL 2.1`, `NFe 4.0`… */
  @Column({ type: 'varchar', length: 32 })
  regime: string;

  @Column({ name: 'fiscal_number', type: 'varchar', length: 64, nullable: true })
  fiscalNumber?: string | null;

  /**
   * The kind of document this is, as its market's catalogue names it: `E31` for a Dominican e-CF of
   * credit, `I` for a CFDI de ingreso, `55` for an NF-e. The same code
   * `fiscal_document_ranges.document_type` is authorised under, recorded as it was drawn rather
   * than parsed back out of the number, whose shape is the market's mask.
   */
  @Column({ name: 'document_type', type: 'varchar', length: 8, nullable: true })
  documentType?: string | null;

  @Column({ type: 'enum', enum: FiscalSubmissionStatus, default: FiscalSubmissionStatus.PENDING })
  status: FiscalSubmissionStatus;

  /** CUFE, clave de acceso, chave de acesso: computed from the document at build time. */
  @Column({ name: 'document_key', type: 'varchar', length: 128, nullable: true })
  documentKey?: string | null;

  /** The authority's handle: UUID (CFDI), trackId, CAE, protocolo. */
  @Column({ name: 'tracking_id', type: 'varchar', length: 128, nullable: true })
  trackingId?: string | null;

  /**
   * Where the authority's portal verifies this document, as printed on it: the QR of the Dominican
   * representación impresa, the NFC-e QR, the SRI's lookup by clave de acceso. Null where the
   * regime prints no such link.
   */
  @Column({ name: 'verification_url', type: 'text', nullable: true })
  verificationUrl?: string | null;

  /** The stamp the authority returned, where it returns one to keep (the stamped CFDI, the CAE). */
  @Column({ type: 'text', nullable: true })
  authorization?: string | null;

  /** The sealed document as sent: the evidence of what was declared. */
  @Column({ type: 'text', nullable: true })
  payload?: string | null;

  /** Every message the authority sent, verbatim, accumulated across attempts. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  messages: string[];

  @Column({ type: 'jsonb', nullable: true })
  response?: unknown;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt?: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt?: Date | null;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
