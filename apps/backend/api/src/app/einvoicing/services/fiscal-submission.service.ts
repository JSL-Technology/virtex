import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { FiscalSubmission, FiscalSubmissionStatus } from '../entities/fiscal-submission.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { FiscalRegimeRegistry } from '../regimes/fiscal-regime.registry';
import { FiscalRegimeAdapter, FiscalRegimeContext, FiscalTransmissionResult, RegimeNotConfigured } from '../regimes/fiscal-regime.types';
import { NotFoundError, ConflictError } from '../../i18n/localized.exception';

/** How long a claimed submission is reserved for the worker that claimed it. */
const LEASE_MINUTES = 5;
/** A tenant that has not configured its regime is retried hourly, and at once when it saves settings. */
const NOT_CONFIGURED_RETRY_MINUTES = 60;
/** A verdict still outstanding is asked for again after this long. */
const POLL_MINUTES = 10;
/** Backoff for failures on our side: 2, 4, 8 … minutes, capped at six hours. */
const MAX_BACKOFF_MINUTES = 6 * 60;

const RETRIABLE = [FiscalSubmissionStatus.PENDING, FiscalSubmissionStatus.ERROR, FiscalSubmissionStatus.NOT_CONFIGURED];
const FINAL = [FiscalSubmissionStatus.ACCEPTED, FiscalSubmissionStatus.REJECTED];

/**
 * The electronic documents of every regime but the Dominican one, from the issued invoice to the
 * authority's verdict (audit 2026-11-07, FAC-EINV-01).
 *
 * The seven adapters (CFDI, DIAN, SUNAT, SRI, SII, NF-e, AFIP) could build, seal and transmit, and
 * nothing called them: an invoice in Mexico got a number and was never stamped. Now:
 *
 *  1. `registerPending` writes the submission IN the issuing transaction (an outbox): the invoice
 *     and its obligation to be transmitted commit together, or neither does.
 *  2. After the commit, `process` claims the row — an atomic `UPDATE … RETURNING` that reserves it
 *     for `LEASE_MINUTES`, so two replicas never transmit the same document and no transaction is
 *     held open across an HTTP call — then builds, seals and transmits through the regime adapter.
 *  3. The reconciler (`FiscalSubmissionReconciler`) processes what is due and asks for verdicts.
 *
 * What a run can end in is stated, never invented: `NOT_CONFIGURED` (fixed in settings, retried),
 * `SENT` (asked again later, never resent blindly), `ACCEPTED`/`REJECTED` with the authority's
 * messages verbatim, or `ERROR` on our side with backoff.
 */
@Injectable()
export class FiscalSubmissionService {
  private readonly logger = new Logger(FiscalSubmissionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly registry: FiscalRegimeRegistry,
  ) {}

  /** Whether a market's documents go through this pipeline (every implemented regime but DO). */
  handles(countryCode: string | null | undefined): boolean {
    return this.registry.forCountry(countryCode) !== null;
  }

  /** Record, inside the issuing transaction, that this invoice is owed to the authority. */
  async registerPending(invoice: Invoice, countryCode: string, manager: EntityManager): Promise<void> {
    const adapter = this.registry.forCountry(countryCode);
    if (!adapter) return;
    await manager.query(
      `INSERT INTO fiscal_submissions (organization_id, invoice_id, country_code, regime, fiscal_number, status)
       VALUES ($1, $2, $3, $4, $5, 'PENDING')
       ON CONFLICT (invoice_id) DO NOTHING`,
      [invoice.organizationId, invoice.id, adapter.countryCode, adapter.regime, invoice.fiscalNumber ?? null],
    );
  }

  /**
   * Build, seal and transmit one invoice's document, if it is due. Safe to call from several
   * places at once: only the caller that wins the claim does anything.
   */
  async process(invoiceId: string, organizationId: string): Promise<FiscalSubmission | null> {
    const claimed = await this.claim(organizationId, `invoice_id = $2`, invoiceId, RETRIABLE);
    if (!claimed) return this.findByInvoice(invoiceId, organizationId);

    const adapter = this.registry.forCountry(claimed.countryCode);
    if (!adapter) return this.finish(claimed, { status: FiscalSubmissionStatus.ERROR, lastError: `No regime for ${claimed.countryCode}` });

    const context = await this.contextFor(claimed);
    try {
      const built = await adapter.build(context);
      const certificate = await adapter.loadCertificate(context);
      const sealed = adapter.seal(built, certificate);
      // The sealed document is stored before it is sent: it is the evidence of what was declared,
      // whatever the exchange that follows does.
      await this.patch(claimed.id, organizationId, { payload: sealed.payload, documentKey: sealed.documentKey });
      const result = await adapter.transmit(sealed, context);
      return this.record(claimed, result, sealed.documentKey);
    } catch (error) {
      return this.failure(claimed, error, adapter);
    }
  }

  /** Ask the authority again about a document it received and has not decided on. */
  async poll(submissionId: string, organizationId: string): Promise<FiscalSubmission | null> {
    const claimed = await this.claim(organizationId, `id = $2`, submissionId, [FiscalSubmissionStatus.SENT]);
    if (!claimed) return null;
    const adapter = this.registry.forCountry(claimed.countryCode);
    const handle = claimed.trackingId ?? claimed.documentKey;
    if (!adapter || !handle) {
      return this.finish(claimed, { status: FiscalSubmissionStatus.SENT, nextAttemptAt: minutesFromNow(POLL_MINUTES) });
    }
    try {
      const result = await adapter.checkStatus(handle, await this.contextFor(claimed));
      return this.record(claimed, result, claimed.documentKey ?? null);
    } catch (error) {
      return this.failure(claimed, error, adapter, FiscalSubmissionStatus.SENT);
    }
  }

  /** What is due now in a tenant: to transmit, and to ask about. */
  async findDue(organizationId: string, limit = 50): Promise<Array<Pick<FiscalSubmission, 'id' | 'invoiceId' | 'status'>>> {
    return this.dataSource.query(
      `SELECT id, invoice_id AS "invoiceId", status FROM fiscal_submissions
        WHERE organization_id = $1
          AND status IN ('PENDING', 'ERROR', 'NOT_CONFIGURED', 'SENT')
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY next_attempt_at NULLS FIRST, created_at
        LIMIT $2`,
      [organizationId, limit],
    );
  }

  async findByInvoice(invoiceId: string, organizationId: string): Promise<FiscalSubmission | null> {
    return this.dataSource.getRepository(FiscalSubmission).findOne({ where: { invoiceId, organizationId } });
  }

  /** A person asks for another attempt now. A verdict already given is not reopened. */
  async retryNow(submissionId: string, organizationId: string): Promise<FiscalSubmission> {
    const submission = await this.dataSource.getRepository(FiscalSubmission).findOne({ where: { id: submissionId, organizationId } });
    if (!submission) throw new NotFoundError('einvoicing.submission_not_found');
    if (FINAL.includes(submission.status)) {
      throw new ConflictError('einvoicing.submission_already_decided', { status: submission.status });
    }
    await this.patch(submission.id, organizationId, { nextAttemptAt: null });
    return (submission.status === FiscalSubmissionStatus.SENT
      ? await this.poll(submission.id, organizationId)
      : await this.process(submission.invoiceId, organizationId)) ?? submission;
  }

  /** Settings were saved: what waited for them is due now, not in an hour. */
  async requeueNotConfigured(organizationId: string, countryCode: string): Promise<number> {
    const result = await this.dataSource.query(
      `UPDATE fiscal_submissions SET next_attempt_at = NULL, updated_at = now()
        WHERE organization_id = $1 AND country_code = $2 AND status = 'NOT_CONFIGURED'
        RETURNING id`,
      [organizationId, countryCode.toUpperCase()],
    );
    return returnedRows(result).length;
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────

  /**
   * Reserve one submission for this worker. The `UPDATE … WHERE (due) RETURNING` is atomic: of two
   * workers racing for the same row, exactly one gets it back.
   */
  private async claim(
    organizationId: string,
    match: string,
    value: string,
    statuses: FiscalSubmissionStatus[],
  ): Promise<FiscalSubmission | null> {
    const result = await this.dataSource.query(
      `UPDATE fiscal_submissions
          SET attempts = attempts + 1, next_attempt_at = now() + interval '${LEASE_MINUTES} minutes', updated_at = now()
        WHERE organization_id = $1 AND ${match}
          AND status = ANY($3::fiscal_submissions_status_enum[])
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        RETURNING id`,
      [organizationId, value, statuses],
    );
    const id = returnedRows<{ id: string }>(result)[0]?.id;
    if (!id) return null;
    return this.dataSource.getRepository(FiscalSubmission).findOne({ where: { id, organizationId } });
  }

  private async contextFor(submission: FiscalSubmission): Promise<FiscalRegimeContext> {
    const manager = this.dataSource.manager;
    const invoice = await manager.findOne(Invoice, {
      where: { id: submission.invoiceId, organizationId: submission.organizationId },
      relations: ['lineItems'],
    });
    if (!invoice) throw new NotFoundError('einvoicing.invoice_not_found');
    return { invoice, organizationId: submission.organizationId, manager };
  }

  private record(submission: FiscalSubmission, result: FiscalTransmissionResult, documentKey: string | null): Promise<FiscalSubmission> {
    const base = {
      messages: [...(submission.messages ?? []), ...result.messages],
      response: result.raw ?? null,
      lastError: null,
    };
    switch (result.status) {
      case 'ACCEPTED':
        return this.finish(submission, {
          ...base,
          status: FiscalSubmissionStatus.ACCEPTED,
          trackingId: result.trackingId ?? submission.trackingId ?? null,
          authorization: result.authorization ?? null,
          sentAt: submission.sentAt ?? new Date(),
          respondedAt: new Date(),
          nextAttemptAt: null,
        });
      case 'REJECTED':
        return this.finish(submission, { ...base, status: FiscalSubmissionStatus.REJECTED, sentAt: submission.sentAt ?? new Date(), respondedAt: new Date(), nextAttemptAt: null });
      case 'NOT_CONFIGURED':
        return this.finish(submission, { ...base, status: FiscalSubmissionStatus.NOT_CONFIGURED, nextAttemptAt: minutesFromNow(NOT_CONFIGURED_RETRY_MINUTES) });
      case 'PENDING':
      default: {
        const handle = result.trackingId ?? submission.trackingId ?? documentKey;
        // Received, or possibly received: ask, do not resend. Without any handle to ask by, the
        // authority assigns the identity on acceptance and a resend cannot duplicate it.
        return this.finish(submission, {
          ...base,
          status: handle ? FiscalSubmissionStatus.SENT : FiscalSubmissionStatus.ERROR,
          trackingId: result.trackingId ?? submission.trackingId ?? null,
          sentAt: submission.sentAt ?? new Date(),
          nextAttemptAt: minutesFromNow(handle ? POLL_MINUTES : backoffMinutes(submission.attempts)),
        });
      }
    }
  }

  private failure(
    submission: FiscalSubmission,
    error: unknown,
    adapter: FiscalRegimeAdapter,
    keep?: FiscalSubmissionStatus,
  ): Promise<FiscalSubmission> {
    if (error instanceof RegimeNotConfigured) {
      return this.finish(submission, {
        status: keep ?? FiscalSubmissionStatus.NOT_CONFIGURED,
        lastError: error.message,
        messages: [...(submission.messages ?? []), error.message],
        nextAttemptAt: minutesFromNow(NOT_CONFIGURED_RETRY_MINUTES),
      });
    }
    const message = (error as { messageKey?: string; message?: string })?.messageKey ?? (error as Error)?.message ?? String(error);
    this.logger.warn(`${adapter.regime}: submission ${submission.id} failed — ${message}`);
    return this.finish(submission, {
      status: keep ?? FiscalSubmissionStatus.ERROR,
      lastError: message,
      nextAttemptAt: minutesFromNow(backoffMinutes(submission.attempts)),
    });
  }

  private async finish(submission: FiscalSubmission, changes: Partial<FiscalSubmission>): Promise<FiscalSubmission> {
    await this.patch(submission.id, submission.organizationId, changes);
    return { ...submission, ...changes } as FiscalSubmission;
  }

  private async patch(id: string, organizationId: string, changes: Partial<FiscalSubmission>): Promise<void> {
    await this.dataSource.getRepository(FiscalSubmission).update({ id, organizationId }, changes as never);
  }
}

/** The rows of an `UPDATE … RETURNING`: the postgres driver answers `[rows, affectedCount]`. */
function returnedRows<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  return Array.isArray(result) ? (result as T[]) : [];
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

/** 2^attempts minutes, capped: a transient fault clears quickly, a persistent one stops hammering. */
export function backoffMinutes(attempts: number): number {
  return Math.min(MAX_BACKOFF_MINUTES, 2 ** Math.max(1, Math.min(attempts, 10)));
}
