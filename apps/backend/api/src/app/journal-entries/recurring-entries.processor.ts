
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RecurringJournalEntry } from './entities/recurring-journal-entry.entity';
import { JournalEntriesService } from './journal-entries.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { Ledger } from '../accounting/entities/ledger.entity';

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
                throw new NotFoundException(`Plantilla recurrente ${recurringEntryId} no encontrada.`);
            }

            const defaultLedger = await manager.findOneBy(Ledger, { organizationId: entry.organizationId, isDefault: true });
            if (!defaultLedger) {
                throw new BadRequestException(`No se encontró libro contable para la Org ${entry.organizationId}`);
            }
            
            const dto: CreateJournalEntryDto = {
                date: dateToPost,
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
              throw new InternalServerErrorException('No se pudo obtener el Query Runner de la transacción.');
            }


            await this.journalEntriesService.createWithQueryRunner(manager.queryRunner, dto, entry.organizationId);
            
            entry.lastRunDate = new Date(dateToPost);
            await manager.save(entry);

            this.logger.log(`Asiento para plantilla ${entry.id} creado exitosamente.`);
        });
    }
}