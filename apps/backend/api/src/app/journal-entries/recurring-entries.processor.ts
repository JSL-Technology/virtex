
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RecurringJournalEntry } from './entities/recurring-journal-entry.entity';
import { JournalEntriesService } from './journal-entries.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { Ledger } from '../accounting/entities/ledger.entity';
import { BadRequestError, InternalServerError, NotFoundError } from '../i18n/localized.exception';
import { toIsoDate } from '../common/dates';
import { runAsTenantJob } from '../shared/tenancy/tenant-job';

interface RecurringJobData {
    recurringEntryId: string;
    dateToPost: string;
    organizationId: string;
}

/**
 * Posting the entries a template generates, once each.
 *
 * ## Why "once" needed work
 *
 * The processor posted and *then* stamped `lastRunDate`, and never read it. There was no
 * `if (already run) return`, no unique index over (template, date), and no idempotency key on the
 * entry. The deterministic `jobId` used at enqueue time deduplicates the **enqueue**, not the
 * **execution**: BullMQ recovers stalled jobs when a worker dies, and a worker that dies after the
 * SQL commit and before the acknowledgement causes a second run. The transaction commits again and
 * the entry is duplicated — a monthly rent, an insurance amortisation, a payroll accrual posted
 * twice, with nothing anywhere to flag it.
 *
 * Two guards now, on purpose:
 *
 * 1. `lastRunDate` is re-read inside the transaction, with the row locked, and a date already
 *    posted returns without doing anything. That handles the ordinary redelivery.
 * 2. The posting carries `recurring:{templateId}:{date}` as its idempotency key, which the unique
 *    index on `journal_entries` enforces. That handles the case the first guard cannot: two
 *    workers processing the same redelivered job at the same instant, where both read the row
 *    before either wrote it.
 *
 * The pattern was already in the house — `AutoReversalService` claims its work in the database
 * before doing it — and simply had not been applied here.
 */
@Processor('recurring-entries-processor')
export class RecurringEntriesProcessor extends WorkerHost {
    private readonly logger = new Logger(RecurringEntriesProcessor.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly journalEntriesService: JournalEntriesService,
    ) {
        super();
    }

    async process(job: Job<RecurringJobData>): Promise<void> {
    // The tenant travels in the payload, so the connection this job runs on carries it too.
    // Without that, the row-level policies deny every row and the job "succeeds" having done
    // nothing — a queue that quietly stops working is worse than one that fails.
    return runAsTenantJob(this.dataSource, job.data.organizationId, () => this.runForTenant(job));
  }

  private async runForTenant(job: Job<RecurringJobData>): Promise<void> {
        const { recurringEntryId, dateToPost } = job.data;
        this.logger.log(`Procesando trabajo ${job.id} para la plantilla recurrente ${recurringEntryId}`);

        const postingDate = toIsoDate(dateToPost);

        await this.dataSource.transaction(async manager => {
            // Locked for the duration: two workers handling the same redelivered job would
            // otherwise both read a template that had not yet been stamped, and both post.
            const entry = await manager.findOne(RecurringJournalEntry, {
                where: { id: recurringEntryId },
                lock: { mode: 'pessimistic_write' },
            });
            if (!entry) {
                throw new NotFoundError('JOURNAL_ENTRIES.PLANTILLA_RECURRENTE_NO_ENCONTRADA', { recurringEntryId });
            }

            // Already posted for this date. A redelivered job is not a second occurrence of the
            // rent; it is the same occurrence arriving twice.
            if (entry.lastRunDate && entry.lastRunDate >= postingDate) {
                this.logger.log(
                    `La plantilla ${entry.id} ya se contabilizó hasta ${entry.lastRunDate}; ` +
                        `se omite ${postingDate}.`,
                );
                return;
            }

            const defaultLedger = await manager.findOneBy(Ledger, { organizationId: entry.organizationId, isDefault: true });
            if (!defaultLedger) {
                throw new BadRequestError('JOURNAL_ENTRIES.NO_ENCONTRO_LIBRO_CONTABLE_ORG', { organizationId: entry.organizationId });
            }
            
            const dto: CreateJournalEntryDto = {
                date: postingDate,
                description: `(Recurrente) ${entry.description}`,
                journalId: entry.journalId,
                lines: entry.lines.map(line => ({
                  ...line,
                  valuations: [{
                    ledgerId: defaultLedger.id,
                    debit: line.debit,
                    credit: line.credit
                  }]
                })),
            };


            if (!manager.queryRunner) {
              throw new InternalServerError('JOURNAL_ENTRIES.NO_PUDO_OBTENER_QUERY_RUNNER_TRANSACCION');
            }


            await this.journalEntriesService.createWithQueryRunner(
                manager.queryRunner,
                dto,
                entry.organizationId,
                {
                    actorUserId: null,
                    systemReason: 'recurring-entry',
                    // The structural guard. The unique index on (organization, idempotency_key)
                    // makes a second posting of the same occurrence impossible rather than merely
                    // unlikely, which is what the re-read above can only be.
                    idempotencyKey: `recurring:${entry.id}:${postingDate}`,
                },
            );

            entry.lastRunDate = postingDate;
            await manager.save(entry);

            this.logger.log(`Asiento para plantilla ${entry.id} creado exitosamente.`);
        });
    }
}