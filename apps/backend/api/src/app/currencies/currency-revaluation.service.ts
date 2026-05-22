
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Not, Repository, DataSource } from 'typeorm';
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

  async run(periodEndDate: Date, organizationId: string): Promise<void> {
    this.logger.log(`Iniciando revaluación de moneda para la organización ${organizationId} al ${periodEndDate.toISOString()}`);

    const settings = await this.orgSettingsRepository.findOne({ where: { organizationId } });
    if (!settings || !settings.defaultForexGainLossAccountId) {
      this.logger.error(`Cuentas de Ganancia/Pérdida cambiaria no configuradas para la organización ${organizationId}.`);
      return;
    }
    
    const generalJournal = await this.journalRepository.findOneBy({ organizationId, code: 'GENERAL' });
    if (!generalJournal) {
        throw new BadRequestException('Diario General (GENERAL) no encontrado.');
    }
    
    const defaultLedger = await this.dataSource.getRepository(Ledger).findOneBy({ organizationId, isDefault: true });
    if (!defaultLedger) {
        throw new BadRequestException('No se ha configurado un libro contable por defecto para la organización.');
    }

    const balancesToRevalue = await this.accountBalanceRepository.find({
        where: {
            ledgerId: defaultLedger.id,
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

      const closingRate = await this.exchangeRateRepository.findOne({
          where: { fromCurrency: account.currency, toCurrency: defaultLedger.currency, date: LessThanOrEqual(periodEndDate) },
          order: { date: 'DESC' }
      });

      if (!closingRate) {
          this.logger.warn(`No se encontró tasa de cambio de cierre de ${account.currency} a ${defaultLedger.currency}`);
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
              description: 'Ajuste por revaluación',
              valuations: [{ ledgerId: defaultLedger.id, debit: difference, credit: 0 }]
            },
            { 
              accountId: settings.defaultForexGainLossAccountId, 
              debit: 0, 
              credit: difference, 
              description: 'Ganancia cambiaria',
              valuations: [{ ledgerId: defaultLedger.id, debit: 0, credit: difference }]
            }
          );
        } else {
          entryLines.push(
            { 
              accountId: settings.defaultForexGainLossAccountId, 
              debit: Math.abs(difference), 
              credit: 0, 
              description: 'Pérdida cambiaria',
              valuations: [{ ledgerId: defaultLedger.id, debit: Math.abs(difference), credit: 0 }]
            },
            { 
              accountId: account.id, 
              debit: 0, 
              credit: Math.abs(difference), 
              description: 'Ajuste por revaluación',
              valuations: [{ ledgerId: defaultLedger.id, debit: 0, credit: Math.abs(difference) }]
            }
          );
        }
        
        const entryDto: CreateJournalEntryDto = {
          date: periodEndDate.toISOString(),
          description: `Revaluación de moneda para la cuenta ${account.code}`,
          journalId: generalJournal.id,
          lines: entryLines,
          currencyCode: defaultLedger.currency,
        };
        
        await this.journalEntriesService.create(entryDto, organizationId);
        this.logger.log(`Asiento de revaluación creado para la cuenta ${account.code} por un monto de ${difference.toFixed(2)} ${defaultLedger.currency}`);
      }
    }
  }
}