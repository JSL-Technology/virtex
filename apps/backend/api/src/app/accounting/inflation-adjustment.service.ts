
import { Injectable, NotFoundException, BadRequestException, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { InflationIndex } from './entities/inflation-index.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { Journal } from '../journal-entries/entities/journal.entity';
import { CreateJournalEntryLineDto, CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { Ledger } from './entities/ledger.entity';

@Injectable()
export class InflationAdjustmentService {
  private readonly logger = new Logger(InflationAdjustmentService.name);

  constructor(
    @InjectRepository(InflationIndex)
    private readonly inflationIndexRepository: Repository<InflationIndex>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(OrganizationSettings)
    private readonly orgSettingsRepository: Repository<OrganizationSettings>,
    private readonly journalEntriesService: JournalEntriesService,
    private readonly dataSource: DataSource,
  ) {}

  async runAdjustment(year: number, month: number, organizationId: string): Promise<void> {
    this.logger.log(`Iniciando ajuste por inflación para ${year}-${month}, Org: ${organizationId}`);

    const inflationIndex = await this.inflationIndexRepository.findOneBy({ year, month, organizationId });
    if (!inflationIndex) {
      throw new NotFoundException(`Índice de inflación para ${year}-${month} no encontrado.`);
    }

    const settings = await this.orgSettingsRepository.findOneBy({ organizationId });
    if (!settings?.defaultInflationAdjustmentAccountId) {
        throw new BadRequestException('La cuenta para el ajuste por inflación no está configurada.');
    }

    const defaultLedger = await this.dataSource.getRepository(Ledger).findOneBy({ organizationId, isDefault: true });
    if (!defaultLedger) {
        throw new BadRequestException('No se ha configurado un libro contable por defecto para la organización.');
    }
    
    const accountsToAdjust = await this.accountRepository.find({
        where: { organizationId, isInflationAdjustable: true },
        relations: ['balances'],
    });

    if (accountsToAdjust.length === 0) {
        this.logger.log('No hay cuentas marcadas para ajuste por inflación.');
        return;
    }

    await this.dataSource.transaction(async manager => {
        const adjustmentJournal = await manager.findOneBy(Journal, { organizationId, code: 'AJU-INF' });
        if (!adjustmentJournal) {
            throw new BadRequestException('Diario de Ajuste por Inflación (AJU-INF) no encontrado.');
        }

        let totalAdjustment = 0;
        const lines: CreateJournalEntryLineDto[] = [];

        for (const account of accountsToAdjust) {
            const balanceRecord = account.balances.find(b => b.ledgerId === defaultLedger.id);
            const currentBalance = balanceRecord ? Number(balanceRecord.balance) : 0;

            if (Math.abs(currentBalance) === 0) continue;

            const adjustmentAmount = currentBalance * Number(inflationIndex.rate);
            totalAdjustment += adjustmentAmount;

            const debit = adjustmentAmount > 0 ? adjustmentAmount : 0;
            const credit = adjustmentAmount < 0 ? Math.abs(adjustmentAmount) : 0;

            lines.push({
                accountId: account.id,
                debit: debit,
                credit: credit,
                description: `Ajuste por inflación ${year}-${month}`,
                valuations: [{
                    ledgerId: defaultLedger.id,
                    debit: debit,
                    credit: credit
                }]
            });
        }

        if (lines.length === 0) {
            this.logger.log('No se generaron líneas de ajuste (saldos en cero).');
            return;
        }

        if (settings.defaultInflationAdjustmentAccountId) {
          const contraDebit = totalAdjustment < 0 ? Math.abs(totalAdjustment) : 0;
          const contraCredit = totalAdjustment > 0 ? totalAdjustment : 0;

          lines.push({
              accountId: settings.defaultInflationAdjustmentAccountId,
              debit: contraDebit,
              credit: contraCredit,
              description: `Contrapartida ajuste por inflación ${year}-${month}`,
              valuations: [{
                  ledgerId: defaultLedger.id,
                  debit: contraDebit,
                  credit: contraCredit
              }]
          });
        } else {
            throw new InternalServerErrorException('La cuenta de ajuste por inflación desapareció a mitad de la transacción.');
        }

        if (!manager.queryRunner) {
          throw new InternalServerErrorException('No se pudo obtener el Query Runner de la transacción.');
        }


        const entryDto: CreateJournalEntryDto = {
            date: new Date(year, month, 0).toISOString(),
            description: `Asiento de Ajuste por Inflación para ${year}-${month}`,
            lines,
            journalId: adjustmentJournal.id,
        };

        await this.journalEntriesService.createWithQueryRunner(manager.queryRunner, entryDto, organizationId);

        this.logger.log(`Ajuste por inflación completado. Se generó un asiento con ${lines.length} líneas.`);
    });
  }
}