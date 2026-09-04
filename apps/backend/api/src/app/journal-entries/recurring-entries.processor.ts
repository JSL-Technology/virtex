
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

interface RecurringJobData {
    recurringEntryId: string;
    dateToPost: string;
}

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
        const { recurringEntryId, dateToPost } = job.data;
        this.logger.log(`Procesando trabajo ${job.id} para la plantilla recurrente ${recurringEntryId}`);

        await this.dataSource.transaction(async manager => {
            const entry = await manager.findOneBy(RecurringJournalEntry, { id: recurringEntryId });
            if (!entry) {
                throw new NotFoundError('JOURNAL_ENTRIES.PLANTILLA_RECURRENTE_NO_ENCONTRADA', { recurringEntryId });
            }

            const defaultLedger = await manager.findOneBy(Ledger, { organizationId: entry.organizationId, isDefault: true });
            if (!defaultLedger) {
                throw new BadRequestError('JOURNAL_ENTRIES.NO_ENCONTRO_LIBRO_CONTABLE_ORG', { organizationId: entry.organizationId });
            }
            
            const dto: CreateJournalEntryDto = {
                date: toIsoDate(dateToPost),
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


            await this.journalEntriesService.createWithQueryRunner(manager.queryRunner, dto, entry.organizationId);
            
            entry.lastRunDate = toIsoDate(dateToPost);
            await manager.save(entry);

            this.logger.log(`Asiento para plantilla ${entry.id} creado exitosamente.`);
        });
    }
}