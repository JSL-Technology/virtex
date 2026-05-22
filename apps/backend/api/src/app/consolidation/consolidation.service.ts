
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThanOrEqual } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { Account, AccountType } from '../chart-of-accounts/entities/account.entity';
import { FinancialReportingService } from '../financial-reporting/financial-reporting.service';
import { ConsolidationMap } from './entities/consolidation-map.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { ExchangeRate } from '../currencies/entities/exchange-rate.entity';

@Injectable()
export class ConsolidationService {
  private readonly logger = new Logger(ConsolidationService.name);

  constructor(
    @InjectRepository(Organization)
    private readonly orgRepository: Repository<Organization>,
    @InjectRepository(ConsolidationMap)
    private readonly mapRepository: Repository<ConsolidationMap>,
    @InjectRepository(OrganizationSettings)
    private readonly orgSettingsRepository: Repository<OrganizationSettings>,
    @InjectRepository(ExchangeRate)
    private readonly exchangeRateRepository: Repository<ExchangeRate>,
    private readonly financialReportingService: FinancialReportingService,
    private readonly dataSource: DataSource,
  ) {}

  async runConsolidation(parentOrganizationId: string, asOfDate: Date) {
    this.logger.log(
      `Iniciando consolidación para la organización matriz ${parentOrganizationId} a fecha de ${asOfDate.toISOString()}`,
    );

    const parentOrg = await this.orgRepository.findOne({
      where: { id: parentOrganizationId },
      relations: ['subsidiaries', 'subsidiaries.subsidiary'],
    });

    if (!parentOrg) {
      throw new NotFoundException('Organización matriz no encontrada.');
    }
    if (!parentOrg.subsidiaries || parentOrg.subsidiaries.length === 0) {
      throw new BadRequestException(
        'La organización no tiene subsidiarias configuradas para consolidar.',
      );
    }

    const parentSettings = await this.orgSettingsRepository.findOneBy({
        organizationId: parentOrganizationId
    });
    if(!parentSettings) {
        throw new NotFoundException(`Configuraciones para la organización matriz ${parentOrganizationId} no encontradas.`);
    }
    const parentBaseCurrency = parentSettings.baseCurrency;


    const consolidatedBalances = new Map<string, { account: Account; balance: number }>();


    this.logger.log(`Cargando balance para la compañía matriz: ${parentOrg.legalName}`);
    const parentBalanceSheet = await this.financialReportingService.getBalanceSheet(parentOrganizationId, asOfDate);
    
    const allParentAccounts = [
        ...parentBalanceSheet.assets, 
        ...parentBalanceSheet.liabilities, 
        ...parentBalanceSheet.equity
    ];

    for (const account of allParentAccounts) {
      consolidatedBalances.set(account.code, { account, balance: account.balance });
    }
    

    for (const subRelation of parentOrg.subsidiaries) {
        const subsidiary = subRelation.subsidiary;
        this.logger.log(`Procesando subsidiaria: ${subsidiary.legalName} (Propiedad: ${subRelation.ownership}%)`);


        const mapping = await this.mapRepository.find({
            where: { parentOrganizationId, subsidiaryOrganizationId: subsidiary.id },
            relations: ['parentAccount'],
        });

        if (mapping.length === 0) {
            this.logger.warn(`No se encontró un mapa de consolidación para la subsidiaria ${subsidiary.legalName}. Será omitida.`);
            continue;
        }
        const consolidationMap = new Map(mapping.map(m => [m.subsidiaryAccountId, m.parentAccount]));


        const subsidiarySettings = await this.orgSettingsRepository.findOneBy({ organizationId: subsidiary.id });
        const subsidiaryBaseCurrency = subsidiarySettings?.baseCurrency;
        let exchangeRate = 1.0;

        if (subsidiaryBaseCurrency && subsidiaryBaseCurrency !== parentBaseCurrency) {
            const rate = await this.exchangeRateRepository.findOne({
                where: { fromCurrency: subsidiaryBaseCurrency, toCurrency: parentBaseCurrency, date: LessThanOrEqual(asOfDate) },
                order: { date: 'DESC' }
            });
            if (!rate) {
                this.logger.error(`No se encontró tasa de cambio de ${subsidiaryBaseCurrency} a ${parentBaseCurrency} para la fecha ${asOfDate}. La subsidiaria ${subsidiary.legalName} será omitida.`);
                continue;
            }
            exchangeRate = rate.rate;
            this.logger.log(`Tasa de cambio aplicada para ${subsidiary.legalName}: ${exchangeRate}`);
        }


        const subsidiaryBalanceSheet = await this.financialReportingService.getBalanceSheet(subsidiary.id, asOfDate);
        const allSubsidiaryAccounts = [...subsidiaryBalanceSheet.assets, ...subsidiaryBalanceSheet.liabilities, ...subsidiaryBalanceSheet.equity];


        for (const subAccount of allSubsidiaryAccounts) {
            const parentAccount = consolidationMap.get(subAccount.id);

            if (!parentAccount) {
                this.logger.warn(`La cuenta ${subAccount.code} (${subAccount.name}) de la subsidiaria ${subsidiary.legalName} no tiene mapeo y será ignorada.`);
                continue;
            }
            
            const convertedBalance = subAccount.balance * exchangeRate;
            
            if (consolidatedBalances.has(parentAccount.code)) {
                const existing = consolidatedBalances.get(parentAccount.code)!;
                existing.balance += convertedBalance;
            } else {

                consolidatedBalances.set(parentAccount.code, { account: parentAccount, balance: convertedBalance });
            }
        }
    }


    const finalAccounts = Array.from(consolidatedBalances.values());

    return {
        consolidationDate: new Date(),
        asOfDate,
        parentOrganization: parentOrg.legalName,
        consolidatedAssets: finalAccounts
            .filter(a => a.account.type === AccountType.ASSET)
            .map(a => ({ ...a.account, balance: a.balance })),
        consolidatedLiabilities: finalAccounts
            .filter(a => a.account.type === AccountType.LIABILITY)
            .map(a => ({ ...a.account, balance: a.balance })),
        consolidatedEquity: finalAccounts
            .filter(a => a.account.type === AccountType.EQUITY)
            .map(a => ({ ...a.account, balance: a.balance })),
    };
  }
}
