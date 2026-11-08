import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Invoice } from '../../invoices/entities/invoice.entity';

/**
 * Where one electronic document stands with the authority, outside the Dominican Republic
 * (which keeps `ecf_submissions`, its own model since before this interface).
 *
 *  - `PENDING`: committed with the invoice, not yet attempted.
 *  - `NOT_CONFIGURED`: built and sealed where possible, not sent — the tenant has no certificate
 *    or transmission configured, or this environment has fiscal-authority calls disabled. Fixed
 *    in settings, then retried; never confused with a rejection.
 *  - `SENT`: the authority received it and has not answered yet (or the exchange's outcome is
 *    unknown): the reconciler asks again. Never resent blindly — that is how one sale ends with two
 *    fiscal documents.
 *  - `ACCEPTED` / `REJECTED`: the authority's verdict, with its messages verbatim.
 *  - `ERROR`: the step on our side failed (build, seal); retried with backoff.
 */
export enum FiscalSubmissionStatus {
  PENDING = 'PENDING',
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  SENT = 'SENT',
  ACCEPTED = 'ACCEPTED',
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

  @Column({ type: 'enum', enum: FiscalSubmissionStatus, default: FiscalSubmissionStatus.PENDING })
  status: FiscalSubmissionStatus;

  /** CUFE, clave de acceso, chave de acesso: computed from the document at build time. */
  @Column({ name: 'document_key', type: 'varchar', length: 128, nullable: true })
  documentKey?: string | null;

  /** The authority's handle: UUID (CFDI), trackId, CAE, protocolo. */
  @Column({ name: 'tracking_id', type: 'varchar', length: 128, nullable: true })
  trackingId?: string | null;

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
