
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JournalEntriesService } from './journal-entries.service';
import { CreateReclassificationEntryDto } from './dto/reclassification-entry.dto';
import { JournalEntry, JournalEntryType } from './entities/journal-entry.entity';
import { CreatePeriodEndAdjustmentDto } from './dto/period-end-adjustment.dto';
import { CreateAuditAdjustmentDto } from './dto/audit-adjustment.dto';
import { FiscalYear, FiscalYearStatus } from '../accounting/entities/fiscal-year.entity';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { BadRequestError, InternalServerError, NotFoundError } from '../i18n/localized.exception';

@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly journalEntriesService: JournalEntriesService,
    private readonly dataSource: DataSource,
  ) {}

  async createReclassification(
    dto: CreateReclassificationEntryDto,
    organizationId: string,
    actorUserId: string,
  ): Promise<JournalEntry> {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestError('JOURNAL_ENTRIES.CUENTA_ORIGEN_DESTINO_NO_PUEDEN_SER_MISMA');
    }




    const entryDto = {
      date: dto.date,
      description: `Reclasificación: ${dto.description}`,
      journalId: dto.journalId,
      lines: [
        {
          accountId: dto.fromAccountId,
          credit: dto.amount,
          debit: 0,
          description: `Transferencia a cta. relacionada con ${dto.toAccountId.substring(0,8)}`,
        },
        {
          accountId: dto.toAccountId,
          debit: dto.amount,
          credit: 0,
          description: `Transferencia desde cta. relacionada con ${dto.fromAccountId.substring(0,8)}`,
        },
      ],
    };

    return this.journalEntriesService.create(entryDto, organizationId, {
      actorUserId,
    });
  }

  async createPeriodEndAdjustment(dto: CreatePeriodEndAdjustmentDto, organizationId: string): Promise<{ adjustment: JournalEntry }> {
    return this.dataSource.transaction(async manager => {
        if (!manager.queryRunner) {
            throw new InternalServerError('JOURNAL_ENTRIES.NO_PUDO_OBTENER_QUERY_RUNNER_TRANSACCION');
        }
        

        const createWithManager = (d: CreateJournalEntryDto) => this.journalEntriesService.createWithQueryRunner(
          manager.queryRunner!,
          d,
          organizationId,
        );

        const adjustment = await createWithManager({
            date: dto.date,
            description: `Ajuste de fin de período (${dto.adjustmentType}): ${dto.description}`,
            journalId: dto.journalId,
            lines: dto.lines,
        });

        if (dto.reversesNextPeriod) {
            adjustment.reversesNextPeriod = true;
            await manager.save(adjustment);
        }
        
        return { adjustment };
    });
  }

  async createAuditAdjustment(
    dto: CreateAuditAdjustmentDto,
    organizationId: string,
    /** Null when the proposer's account has since been deleted; the entry is then unattributed. */
    actorUserId: string | null,
  ): Promise<JournalEntry> {
    const { fiscalYearId, ...entryData } = dto;
    
    const fiscalYearRepo = this.dataSource.getRepository(FiscalYear);
    const fiscalYear = await fiscalYearRepo.findOneBy({ id: fiscalYearId, organizationId });

    if (!fiscalYear) {
      throw new NotFoundError('JOURNAL_ENTRIES.ANO_FISCAL_NO_ENCONTRADO');
    }
    if (fiscalYear.status === FiscalYearStatus.OPEN) {
      throw new BadRequestError('JOURNAL_ENTRIES.AJUSTES_AUDITORIA_SOLO_PUEDEN_APLICARSE_ANOS_FISCALES');
    }
    if (fiscalYear.status === FiscalYearStatus.LOCKED) {
      throw new BadRequestError('JOURNAL_ENTRIES.ANO_FISCAL_ESTA_ARCHIVADO_NO_PUEDE_MODIFICAR');
    }


    const adjustmentDate = fiscalYear.endDate;
    
    const entryDto = {
      ...entryData,
      date: adjustmentDate.toISOString(),
      entryType: JournalEntryType.AUDIT_ADJUSTMENT,
      affectsOpeningBalance: true,
    };



    return this.journalEntriesService.create(entryDto, organizationId, {
      actorUserId,
    });
  }
}