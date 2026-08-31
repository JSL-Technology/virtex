
import { Injectable, Logger, Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { EventsGateway } from '../../websockets/events.gateway';
import { FileParserService } from '../../journal-entries/parsers/file-parser.service';
import { ChartOfAccountsService } from '../chart-of-accounts.service';
import { Account } from '../entities/account.entity';
import {
  ColumnMappingDto,
  ImportBatch,
  PreviewCoaImportResponseDto,
  ValidatedRow,
} from './dto/coa-import.dto';
import { AccountNature, AccountType } from '../enums/account-enums';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { CreateAccountDto } from '../dto/create-account.dto';
import { FastifyFile } from '../../common/interfaces/fastify-file.interface';
import { BadRequestError, InternalServerError, NotFoundError } from '../../i18n/localized.exception';

@Injectable()
export class CoaImportService {
  private readonly logger = new Logger(CoaImportService.name);

  constructor(
    private readonly coaService: ChartOfAccountsService,
    private readonly fileParser: FileParserService,
    private readonly eventsGateway: EventsGateway,
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  getImportTemplate() {
    const headers =
      'Code,Name,Type,Category,Nature,IsPostable,Description,ParentCode\n';
    const example =
      '1101-01-001,Caja General,ASSET,CURRENT_ASSET,DEBIT,true,Caja principal de la oficina,1101-01\n';
    return { headers, example };
  }

  async preview(
    file: FastifyFile,
    mapping: ColumnMappingDto,
    organizationId: string,
    userId: string,
  ): Promise<PreviewCoaImportResponseDto> {
    const { data } = await this.fileParser.parse(file);
    if (data.length === 0) throw new BadRequestError('CHART_OF_ACCOUNTS.FILE_EMPTY');

    const existingAccounts =
      await this.coaService.findAllForOrg(organizationId);
    const existingCodeMap = new Map(
      existingAccounts.map((acc) => [acc.code, acc]),
    );
    const newCodeMap = new Map<string, any>();

    const validatedRows: ValidatedRow[] = [];
    let validCount = 0;
    let invalidCount = 0;

    for (const [index, row] of data.entries()) {
      const validatedRow: ValidatedRow = {
        lineNumber: index + 2,
        data: row,
        isValid: true,
        errors: [],
      };

      const code = row[mapping.code];
      if (!code) validatedRow.errors.push('Code is required.');
      if (!row[mapping.name]) validatedRow.errors.push('Name is required.');
      if (!Object.values(AccountType).includes(row[mapping.type]))
        validatedRow.errors.push('Invalid Account Type.');

      if (existingCodeMap.has(code) || newCodeMap.has(code)) {
        validatedRow.errors.push(
          `Account code '${code}' already exists or is duplicated in the file.`,
        );
      }

      if (validatedRow.errors.length > 0) {
        validatedRow.isValid = false;
        invalidCount++;
      } else {
        validCount++;
        newCodeMap.set(code, row);
      }
      validatedRows.push(validatedRow);
    }

    for (const row of validatedRows) {
      if (row.isValid && row.data[mapping.parentCode]) {
        const parentCode = row.data[mapping.parentCode];
        if (!existingCodeMap.has(parentCode) && !newCodeMap.has(parentCode)) {
          row.isValid = false;
          row.errors.push(
            `Parent code '${parentCode}' not found in existing accounts or in the file.`,
          );
          validCount--;
          invalidCount++;
        }
      }
    }

    const batchId = uuidv4();
    const batchData: ImportBatch = {
      id: batchId,
      organizationId,
      userId,
      mapping,
      rows: validatedRows.filter((r) => r.isValid),
      createdAt: new Date(),
    };

    await this.cacheManager.set(`coa-import-batch:${batchId}`, batchData, 1800);

    return {
      batchId,
      totalRows: data.length,
      validCount,
      invalidCount,
      validatedRows,
    };
  }

  async confirm(batchId: string, organizationId: string, userId: string) {
    const batch = await this.cacheManager.get<ImportBatch>(
      `coa-import-batch:${batchId}`,
    );
    if (
      !batch ||
      batch.organizationId !== organizationId ||
      batch.userId !== userId
    ) {
      throw new NotFoundError('CHART_OF_ACCOUNTS.IMPORT_BATCH_NOT_FOUND_OR_EXPIRED');
    }

    this.logger.log(
      `Confirming CoA import batch ${batchId} for org ${organizationId}`,
    );

    const sortedRows = batch.rows.sort((a, b) => {
      const codeA = a.data[batch.mapping.code] || '';
      const codeB = b.data[batch.mapping.code] || '';
      return codeA.localeCompare(codeB);
    });

    const total = sortedRows.length;
    let processed = 0;

    try {
      await this.dataSource.transaction(async (manager) => {
        const existingAccounts = await manager.find(Account, {
          where: { organizationId },
        });
        const existingCodeMap = new Map(
          existingAccounts.map((acc) => [acc.code, acc]),
        );
        const createdAccountsMapInTx = new Map<string, Account>();

        for (const row of sortedRows) {
          const rowData = row.data;
          const parentCode = rowData[batch.mapping.parentCode];
          let parentId: string | null = null;

          if (parentCode) {
            const parentInDb = existingCodeMap.get(parentCode);
            const parentInFile = createdAccountsMapInTx.get(parentCode);
            if (parentInFile) {
              parentId = parentInFile.id;
            } else if (parentInDb) {
              parentId = parentInDb.id;
            } else {
              throw new BadRequestError('CHART_OF_ACCOUNTS.ERROR_CONSISTENCIA_CUENTA_PADRE_CUENTA_NO_FUE', { parentCode, p2: rowData[batch.mapping.code] });
            }
          }


          const fullCode = rowData[batch.mapping.code];
          const segments = fullCode.split('-');
          

          const createAccountDto: CreateAccountDto = {
            segments: segments,
            name: rowData[batch.mapping.name],
            type: rowData[batch.mapping.type] as AccountType,
            category: rowData[batch.mapping.category],
            nature: rowData[batch.mapping.nature] as AccountNature,
            isPostable: ['true', '1', 'yes'].includes(
              String(rowData[batch.mapping.isPostable])?.toLowerCase(),
            ),
            description: rowData[batch.mapping.description] || undefined,
            parentId: parentId,
          };
          
          const newAccount = await this.coaService.createInTransaction(
            createAccountDto,
            organizationId,
            manager,
          );


          createdAccountsMapInTx.set(newAccount.code, newAccount);
          processed++;
          this.eventsGateway.sendToUser(userId, 'import-progress', {
            batchId,
            progress: Math.round((processed / total) * 100),
            processed,
            total,
          });
        }
      });
    } catch (error) {
      this.logger.error(
        `Falló la transacción de importación del lote ${batchId}. Revertiendo cambios. Error: ${(error as Error).message}`,
        (error as Error).stack,
      );
      this.eventsGateway.sendToUser(userId, 'import-complete', {
        batchId,
        status: 'FAILED',
        message: (error as Error).message,
      });
      throw new InternalServerError('CHART_OF_ACCOUNTS.IMPORTACION_FALLO_FUE_REVERTIDA', { p1: (error as Error).message });
    }

    await this.cacheManager.del(`coa-import-batch:${batchId}`);
    this.eventsGateway.sendToUser(userId, 'import-complete', {
      batchId,
      status: 'SUCCESS',
    });

    return { message: `${processed} accounts imported successfully.` };
  }
}