import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EcfSubmissionService } from './ecf-submission.service';

/**
 * Background reconciliation for e-CF:
 *   - polls the DGII for the verdict of documents still "En Proceso";
 *   - re-attempts documents left in contingency/error after a DGII outage.
 *
 * Both loops are best-effort and defensive: one failing document never aborts the batch.
 */
@Injectable()
export class EcfReconcilerService {
  private readonly logger = new Logger(EcfReconcilerService.name);

  constructor(private readonly submissions: EcfSubmissionService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async pollPendingVerdicts(): Promise<void> {
    const pending = await this.submissions.findPollable(100);
    if (pending.length === 0) return;
    this.logger.log(`Consultando estado de ${pending.length} e-CF ante la DGII.`);
    for (const submission of pending) {
      try {
        await this.submissions.pollStatus(submission);
      } catch (err) {
        this.logger.warn(`No se pudo consultar el e-CF ${submission.ncf}: ${(err as Error).message}`);
      }
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async retryContingency(): Promise<void> {
    const retriable = await this.submissions.findRetriable(50);
    if (retriable.length === 0) return;
    this.logger.log(`Reintentando ${retriable.length} e-CF en contingencia/error.`);
    for (const submission of retriable) {
      try {
        await this.submissions.submitInvoice(submission.invoiceId, submission.organizationId);
      } catch (err) {
        this.logger.warn(`Reintento fallido para e-CF ${submission.ncf}: ${(err as Error).message}`);
      }
    }
  }
}
