
import { Injectable, BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JournalEntriesService } from './journal-entries.service';
import { CreateReclassificationEntryDto } from './dto/reclassification-entry.dto';
import { JournalEntry, JournalEntryType } from './entities/journal-entry.entity';
import { CreatePeriodEndAdjustmentDto } from './dto/period-end-adjustment.dto';
import { CreateAuditAdjustmentDto } from './dto/audit-adjustment.dto';
import { FiscalYear, FiscalYearStatus } from '../accounting/entities/fiscal-year.entity';

@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly journalEntriesService: JournalEntriesService,
    private readonly dataSource: DataSource,
  ) {}

  async createReclassification(dto: CreateReclassificationEntryDto, organizationId: string): Promise<JournalEntry> {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException('La cuenta de origen y destino no pueden ser la misma.');
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

    return this.journalEntriesService.create(entryDto, organizationId);
  }

  async createPeriodEndAdjustment(dto: CreatePeriodEndAdjustmentDto, organizationId: string): Promise<{ adjustment: JournalEntry }> {
    return this.dataSource.transaction(async manager => {
        if (!manager.queryRunner) {
            throw new InternalServerErrorException("No se pudo obtener el Query Runner de la transacción.");
        }
        

        const createWithManager = (d) => this.journalEntriesService.createWithQueryRunner(
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

  async createAuditAdjustment(dto: CreateAuditAdjustmentDto, organizationId: string): Promise<JournalEntry> {
    const { fiscalYearId, ...entryData } = dto;
    
    const fiscalYearRepo = this.dataSource.getRepository(FiscalYear);
    const fiscalYear = await fiscalYearRepo.findOneBy({ id: fiscalYearId, organizationId });

    if (!fiscalYear) {
      throw new NotFoundException('Año fiscal no encontrado.');
    }
    if (fiscalYear.status === FiscalYearStatus.OPEN) {
      throw new BadRequestException('Los ajustes de auditoría solo pueden aplicarse a años fiscales cerrados.');
    }
    if (fiscalYear.status === FiscalYearStatus.LOCKED) {
      throw new BadRequestException('El año fiscal está archivado y no se puede modificar.');
    }


    const adjustmentDate = fiscalYear.endDate;
    
    const entryDto = {
      ...entryData,
      date: adjustmentDate.toISOString(),
      entryType: JournalEntryType.AUDIT_ADJUSTMENT,
      affectsOpeningBalance: true,
    };



    return this.journalEntriesService.create(entryDto, organizationId);
  }
}