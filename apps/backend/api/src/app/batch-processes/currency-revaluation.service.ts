
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Not, Repository, DataSource, In, EntityManager } from 'typeorm';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { AccountBalance } from '../chart-of-accounts/entities/account-balance.entity';
import { ExchangeRate } from '../currencies/entities/exchange-rate.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { CreateJournalEntryDto, CreateJournalEntryLineDto } from '../journal-entries/dto/create-journal-entry.dto';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';

@Injectable()
export class CurrencyRevaluationService {
  private readonly logger = new Logger(CurrencyRevaluationService.name);

  constructor(
    @InjectRepository(AccountBalance)
    private readonly accountBalanceRepository: Repository<AccountBalance>,
    @InjectRepository(ExchangeRate)
    private readonly exchangeRateRepository: Repository<ExchangeRate>,
    @InjectRepository(OrganizationSettings)
    private readonly orgSettingsRepository: Repository<OrganizationSettings>,
    @InjectRepository(Journal)
    private readonly journalRepository: Repository<Journal>,
    private readonly journalEntriesService: JournalEntriesService,
    private readonly dataSource: DataSource,
  ) {}

  async run(periodEndDate: Date, organizationId: string, ledgerId?: string, manager?: EntityManager): Promise<void> {
    const execute = async (transactionManager: EntityManager) => {
      this.logger.log(`Iniciando revaluación de moneda para la organización ${organizationId} al ${periodEndDate.toISOString()}${ledgerId ? ` para el libro ${ledgerId}` : ''}.`);
    
      const ledgersToProcess = await transactionManager.find(Ledger, {
          where: { organizationId, ...(ledgerId && { id: ledgerId }) }
      });

      if (ledgersToProcess.length === 0) {
          throw new BadRequestException(`No se encontraron libros contables para procesar en la organización ${organizationId}.`);
      }

      for (const ledger of ledgersToProcess) {
          await this.runForLedger(periodEndDate, organizationId, ledger, transactionManager);
      }
    };
    
    if (manager) {
        await execute(manager);
    } else {
        await this.dataSource.transaction(execute);
    }
  }

  private async runForLedger(periodEndDate: Date, organizationId: string, ledger: Ledger, manager: EntityManager): Promise<void> {
    this.logger.log(`Procesando revaluación para el libro: ${ledger.name} (ID: ${ledger.id})`);

    const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
    if (!settings || !settings.defaultForexGainLossAccountId) {
      this.logger.error(`Cuentas de Ganancia/Pérdida cambiaria no configuradas para la organización ${organizationId}. Omitiendo libro ${ledger.name}.`);
      return;
    }
    
    const generalJournal = await manager.findOneBy(Journal, { organizationId, code: 'GENERAL' });
    if (!generalJournal) {
        throw new BadRequestException(`Diario General (GENERAL) no encontrado para la organización ${organizationId}.`);
    }


    const balancesToRevalue = await manager.getRepository(AccountBalance).find({
        where: {
            ledgerId: ledger.id,
            account: {
                organizationId,
                isMultiCurrency: true,
            }
        },
        relations: ['account'],
    });

    for (const balance of balancesToRevalue) {
      const { account, balance: currentBalance, balanceInForeignCurrency } = balance;


      if ((!balanceInForeignCurrency || Math.abs(Number(balanceInForeignCurrency)) === 0) && Math.abs(Number(currentBalance)) === 0) {
          continue;
      }

      const closingRate = await manager.findOne(ExchangeRate, {
          where: { fromCurrency: account.currency, toCurrency: ledger.currency, date: LessThanOrEqual(periodEndDate) },
          order: { date: 'DESC' }
      });

      if (!closingRate) {
          this.logger.warn(`No se encontró tasa de cambio de cierre de ${account.currency} a ${ledger.currency} en la fecha ${periodEndDate.toISOString()}. Omitiendo cuenta ${account.code}.`);
          continue;
      }
      
      const revaluedBalance = Number(balanceInForeignCurrency || 0) * closingRate.rate;
      const difference = revaluedBalance - Number(currentBalance);

      if (Math.abs(difference) > 0.01) {
        const entryLines: CreateJournalEntryLineDto[] = [];
        
        if (difference > 0) {
          entryLines.push(
            { 
              accountId: account.id, 
              debit: difference, 
              credit: 0, 
              description: 'Ajuste por revaluación (Ganancia)',
              valuations: [{ ledgerId: ledger.id, debit: difference, credit: 0 }]
            },
            { 
              accountId: settings.defaultForexGainLossAccountId, 
              debit: 0, 
              credit: difference, 
              description: `Ganancia cambiaria no realizada - ${account.currency}`,
              valuations: [{ ledgerId: ledger.id, debit: 0, credit: difference }]
            }
          );
        } else {
          entryLines.push(
            { 
              accountId: settings.defaultForexGainLossAccountId, 
              debit: Math.abs(difference), 
              credit: 0, 
              description: `Pérdida cambiaria no realizada - ${account.currency}`,
              valuations: [{ ledgerId: ledger.id, debit: Math.abs(difference), credit: 0 }]
            },
            { 
              accountId: account.id, 
              debit: 0, 
              credit: Math.abs(difference), 
              description: 'Ajuste por revaluación (Pérdida)',
              valuations: [{ ledgerId: ledger.id, debit: 0, credit: Math.abs(difference) }]
            }
          );
        }
        
        const entryDto: CreateJournalEntryDto = {
          date: periodEndDate.toISOString(),
          description: `Revaluación de moneda para la cuenta ${account.code} en libro '${ledger.name}'`,
          journalId: generalJournal.id,
          lines: entryLines,
          currencyCode: ledger.currency,
        };
        
        if (!manager.queryRunner) {
            throw new Error("QueryRunner is not available on this entity manager.");
        }
        await this.journalEntriesService.createWithQueryRunner(manager.queryRunner, entryDto, organizationId);
        this.logger.log(`Asiento de revaluación creado para la cuenta ${account.code} en el libro ${ledger.name} por un monto de ${difference.toFixed(2)} ${ledger.currency}`);
      }
    }
    this.logger.log(`Proceso de revaluación para el libro ${ledger.name} finalizado.`);
  }
}