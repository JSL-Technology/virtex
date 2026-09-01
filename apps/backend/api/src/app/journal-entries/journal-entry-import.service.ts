
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { JournalEntriesService } from './journal-entries.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import {
  PreviewImportResponseDto,
  ConfirmImportDto,
  PreviewImportRequestDto,
  PreviewedJournalEntryDto,
} from './dto/journal-entry-import.dto';
import { FileParserService } from './parsers/file-parser.service';
import { EventsGateway } from '../websockets/events.gateway';
import { Journal } from './entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { FastifyFile } from '../common/interfaces/fastify-file.interface';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { LocalizedResult } from '../i18n/localized-message';

interface ImportBatch {
  id: string;
  organizationId: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  entries: CreateJournalEntryDto[];
  createdAt: Date;
}
const importBatchCache = new Map<string, ImportBatch>();

@Injectable()
export class JournalEntryImportService {
  private readonly logger = new Logger(JournalEntryImportService.name);

  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly journalEntriesService: JournalEntriesService,
    private readonly dataSource: DataSource,
    private readonly fileParser: FileParserService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async getFileHeaders(file: FastifyFile): Promise<string[]> {
    const { headers } = await this.fileParser.parse(file);
    return headers;
  }

  async preview(
    file: FastifyFile,
    mapping: PreviewImportRequestDto,
    organizationId: string,
  ): Promise<PreviewImportResponseDto> {
    const { data } = await this.fileParser.parse(file);
    if (data.length === 0) throw new BadRequestError('JOURNAL_ENTRIES.ARCHIVO_NO_CONTIENE_DATOS');

    const accountsInDb = await this.accountRepository.find({ where: { organizationId } });
    const accountCodeMap = new Map(accountsInDb.map((acc) => [acc.code, acc]));
    
    const generalJournal = await this.dataSource.getRepository(Journal).findOneBy({ organizationId, code: 'GENERAL' });
    if (!generalJournal) {
        throw new BadRequestError('JOURNAL_ENTRIES.DIARIO_GENERAL_GENERAL_NO_ENCONTRADO_NECESARIO_IMPORTACION');
    }
    
    const defaultLedger = await this.dataSource.getRepository(Ledger).findOneBy({ organizationId, isDefault: true });
    if (!defaultLedger) {
        throw new BadRequestError('JOURNAL_ENTRIES.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION');
    }

    const groupedEntries = this.groupCsvRows(data, mapping.columnMapping.entryId);
    const previewResponse: PreviewImportResponseDto = {
      batchId: uuidv4(),
      totalEntries: 0,
      validEntriesCount: 0,
      invalidEntriesCount: 0,
      previews: [],
    };
    const validEntriesToCache: CreateJournalEntryDto[] = [];

    for (const entryId in groupedEntries) {
      const entryData = groupedEntries[entryId];
      let isEntryValid = true;
      let totalDebit = 0;
      let totalCredit = 0;

      const validatedRows = entryData.rows.map((row, index) => {
        const debitValue = parseFloat(row[mapping.columnMapping.debit] || '0');
        const creditValue = parseFloat(row[mapping.columnMapping.credit] || '0');
        const accountCode = row[mapping.columnMapping.accountCode]?.toString();
        let isValid = true;
        let errorMessage: string | undefined;

        if (isNaN(debitValue) || isNaN(creditValue)) {
            isValid = false;
            errorMessage = 'El débito o crédito no es un número válido.';
        } else if (!accountCodeMap.has(accountCode)) {
            isValid = false;
            errorMessage = `La cuenta con código '${accountCode}' no existe.`;
        }

        if(!isValid) isEntryValid = false;

        totalDebit += debitValue;
        totalCredit += creditValue;
        return { lineNumber: index + 1, isValid, errorMessage, data: row };
      });

      const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;
      if (!isBalanced) {
        isEntryValid = false;
        validatedRows.push({ lineNumber: -1, isValid: false, errorMessage: 'El asiento no está balanceado.', data: {} });
      }

      previewResponse.totalEntries++;
      if (isEntryValid) {
        previewResponse.validEntriesCount++;
        const firstRow = entryData.rows[0];
        
        validEntriesToCache.push({
          date: new Date(firstRow[mapping.columnMapping.date]).toISOString(),
          description: firstRow[mapping.columnMapping.description],
          journalId: generalJournal.id,
          lines: validatedRows.map((r) => {
            const debit = parseFloat(r.data[mapping.columnMapping.debit] || '0');
            const credit = parseFloat(r.data[mapping.columnMapping.credit] || '0');
            return {
              accountId: accountCodeMap.get(r.data[mapping.columnMapping.accountCode].toString())!.id,
              debit: debit,
              credit: credit,
              description: r.data[mapping.columnMapping.lineDescription!] || '',
              valuations: [{
                ledgerId: defaultLedger.id,
                debit: debit,
                credit: credit
              }]
            };
          }),
        });
      } else {
        previewResponse.invalidEntriesCount++;
      }
      previewResponse.previews.push({ entryId, isBalanced, totalDebit, totalCredit, rows: validatedRows });
    }

    importBatchCache.set(previewResponse.batchId, {
      id: previewResponse.batchId,
      organizationId,
      status: 'PENDING',
      entries: validEntriesToCache,
      createdAt: new Date(),
    });

    this.cleanupExpiredBatches();
    return previewResponse;
  }

  async confirm(
    confirmDto: ConfirmImportDto,
    organizationId: string,
    userId: string,
  ): Promise<LocalizedResult<{ createdEntriesCount: number }>> {
    const batch = importBatchCache.get(confirmDto.batchId);
    if (!batch || batch.organizationId !== organizationId || batch.status !== 'PENDING') {
      throw new NotFoundError('JOURNAL_ENTRIES.LOTE_IMPORTACION_NO_ENCONTRADO_EXPIRADO_YA_PROCESADO');
    }

    const totalEntries = batch.entries.length;
    let processedCount = 0;

    await this.dataSource.transaction(async (manager) => {
      for (const entryDto of batch.entries) {
        if (!manager.queryRunner) {
            throw new Error('Transaction query runner not available');
        }
        await this.journalEntriesService.createWithQueryRunner(manager.queryRunner, entryDto, organizationId);
        processedCount++;
        
        this.eventsGateway.sendToUser(userId, 'import-progress', {
          batchId: confirmDto.batchId,
          progress: Math.round((processedCount / totalEntries) * 100),
          processed: processedCount,
          total: totalEntries,
        });
      }
    });

    batch.status = 'CONFIRMED';
    this.logger.log(`Lote de importación ${confirmDto.batchId} confirmado. Creados ${totalEntries} asientos.`);

    this.eventsGateway.sendToUser(userId, 'import-complete', {
      batchId: confirmDto.batchId,
      status: 'SUCCESS',
      message: `Importación completada. Se crearon ${totalEntries} asientos.`,
    });

    return {
      messageKey: 'JOURNAL_ENTRIES.IMPORTACION_CONFIRMADA_PROCESADA_EXITOSAMENTE',
      createdEntriesCount: totalEntries,
    };
  }

  private groupCsvRows(rows: any[], entryIdColumn: string): Record<string, { rows: any[] }> {
    return rows.reduce((acc, row) => {
      const entryId = row[entryIdColumn];
      if (!acc[entryId]) {
        acc[entryId] = { rows: [] };
      }
      acc[entryId].rows.push(row);
      return acc;
    }, {});
  }

  private cleanupExpiredBatches(): void {
    const expirationTime = 30 * 60 * 1000;
    const now = new Date().getTime();
    for (const [key, batch] of importBatchCache.entries()) {
      if (now - batch.createdAt.getTime() > expirationTime) {
        importBatchCache.delete(key);
        this.logger.log(`Lote de importación expirado y eliminado: ${key}`);
      }
    }
  }
}