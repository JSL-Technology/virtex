
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { InflationIndex } from './entities/inflation-index.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { Journal } from '../journal-entries/entities/journal.entity';
import { CreateJournalEntryLineDto, CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { Ledger } from './entities/ledger.entity';
import { BadRequestError, InternalServerError, NotFoundError } from '../i18n/localized.exception';
import { AccountBalancesService } from '../chart-of-accounts/account-balances.service';
import { roundAmount, toCents } from '../common/money';

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
    private readonly accountBalances: AccountBalancesService,
    private readonly dataSource: DataSource,
  ) {}

  async runAdjustment(
    year: number,
    month: number,
    organizationId: string,
    actorUserId: string,
  ): Promise<void> {
    this.logger.log(`Iniciando ajuste por inflación para ${year}-${month}, Org: ${organizationId}`);

    const inflationIndex = await this.inflationIndexRepository.findOneBy({ year, month, organizationId });
    if (!inflationIndex) {
      throw new NotFoundError('ACCOUNTING.INDICE_INFLACION_NO_ENCONTRADO', { year, month });
    }

    const settings = await this.orgSettingsRepository.findOneBy({ organizationId });
    if (!settings?.defaultInflationAdjustmentAccountId) {
        throw new BadRequestError('ACCOUNTING.CUENTA_AJUSTE_INFLACION_NO_ESTA_CONFIGURADA');
    }

    const defaultLedger = await this.dataSource.getRepository(Ledger).findOneBy({ organizationId, isDefault: true });
    if (!defaultLedger) {
        throw new BadRequestError('ACCOUNTING.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION');
    }
    
    const accountsToAdjust = await this.accountRepository.find({
        where: { organizationId, isInflationAdjustable: true },
    });

    if (accountsToAdjust.length === 0) {
        this.logger.log('No hay cuentas marcadas para ajuste por inflación.');
        return;
    }

    await this.dataSource.transaction(async manager => {
        const adjustmentJournal = await manager.findOneBy(Journal, { organizationId, code: 'AJU-INF' });
        if (!adjustmentJournal) {
            throw new BadRequestError('ACCOUNTING.DIARIO_AJUSTE_INFLACION_AJU_INF_NO_ENCONTRADO');
        }

        // The last day of the month being adjusted, in UTC. `new Date(year, month, 0)` builds a
        // *local* date, so on any server west of Greenwich the cut-off slipped into the previous
        // month and the adjustment was computed over the wrong balances.
        const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

        const balances = await this.accountBalances.balancesAsOf(
            {
                organizationId,
                ledgerId: defaultLedger.id,
                accountIds: accountsToAdjust.map((account) => account.id),
                asOf: periodEnd,
            },
            manager,
        );

        let totalAdjustmentCents = 0;
        const lines: CreateJournalEntryLineDto[] = [];

        for (const account of accountsToAdjust) {
            const currentBalance = balances.get(account.id) ?? 0;
            if (toCents(currentBalance) === 0) continue;

            const adjustmentAmount = roundAmount(currentBalance * Number(inflationIndex.rate));
            if (toCents(adjustmentAmount) === 0) continue;
            totalAdjustmentCents += toCents(adjustmentAmount);

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
          const totalAdjustment = roundAmount(totalAdjustmentCents / 100);
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
            throw new InternalServerError('ACCOUNTING.CUENTA_AJUSTE_INFLACION_DESAPARECIO_MITAD_TRANSACCION');
        }

        const entryDto: CreateJournalEntryDto = {
            date: periodEnd,
            description: `Asiento de ajuste por inflación ${year}-${month}`,
            lines,
            journalId: adjustmentJournal.id,
        };

        await this.journalEntriesService.createWithManager(manager, entryDto, organizationId, {
            actorUserId,
            systemReason: 'inflation-adjustment',
        });

        this.logger.log(`Ajuste por inflación completado. Se generó un asiento con ${lines.length} líneas.`);
    });
  }
}