

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { FixedAsset, FixedAssetStatus } from './entities/fixed-asset.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Organization } from '../organizations/entities/organization.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';

@Injectable()
export class DepreciationService {
  private readonly logger = new Logger(DepreciationService.name);

  constructor(
    @InjectRepository(FixedAsset)
    private readonly fixedAssetRepository: Repository<FixedAsset>,
    @InjectRepository(OrganizationSettings)
    private readonly orgSettingsRepository: Repository<OrganizationSettings>,
    @InjectRepository(Journal)
    private readonly journalRepository: Repository<Journal>,
    private readonly journalEntriesService: JournalEntriesService,
    private readonly dataSource: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'monthly-depreciation' })
  async handleCron() {
    this.logger.log('Iniciando job de depreciación mensual...');
    const organizations = await this.dataSource.getRepository(Organization).find();
    for (const org of organizations) {

        await this.runMonthlyDepreciation(org.id).catch(err => {
            this.logger.error(`Fallo en el job de depreciación para la organización ${org.id}`, err.stack);
        });
    }
  }

  async runMonthlyDepreciation(organizationId: string, depreciationDate: Date = new Date(), manager?: EntityManager): Promise<void> {
    const execute = async (transactionManager: EntityManager) => {
      const settings = await transactionManager.findOneBy(OrganizationSettings, { organizationId });
      if (!settings || !settings.defaultDepreciationExpenseAccountId || !settings.defaultAccumulatedDepreciationAccountId) {
          this.logger.error(`Cuentas para depreciación no configuradas en la organización ${organizationId}. El proceso de depreciación se omitirá.`);
          return;
      }

      const defaultLedger = await transactionManager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!defaultLedger) {
          this.logger.error(`Libro contable por defecto no encontrado para la organización ${organizationId}. El proceso se omitirá.`);
          return;
      }

      const depreciationJournal = await transactionManager.findOneBy(Journal, { organizationId, code: 'DEPREC' });
      if (!depreciationJournal) {
          throw new BadRequestException('Diario de Depreciación (DEPREC) no encontrado. Por favor, cree un diario con este código para continuar.');
      }
      
      const assetsToDepreciate = await transactionManager.find(FixedAsset, { 
        where: { 
          organizationId,
          status: FixedAssetStatus.IN_USE 
        } 
      });

      this.logger.log(`Se encontraron ${assetsToDepreciate.length} activos para procesar en la organización ${organizationId}.`);

      for (const asset of assetsToDepreciate) {
        const depreciableValue = asset.cost - asset.residualValue;
        if (asset.accumulatedDepreciation >= depreciableValue) {
          continue;
        }

        let monthlyDepreciation = 0;
        const purchaseDate = new Date(asset.purchaseDate);
        const ageInMonths = (depreciationDate.getFullYear() - purchaseDate.getFullYear()) * 12 + depreciationDate.getMonth() - purchaseDate.getMonth();

        const usefulLifeInMonths = asset.usefulLife;

        switch (asset.depreciationMethod) {
          case 'SUM_OF_YEARS_DIGITS':
            const n = usefulLifeInMonths / 12;
            const sumOfDigits = (n * (n + 1)) / 2;
            const currentYear = Math.floor(ageInMonths / 12) + 1;
            if (currentYear <= n) {
              const yearlyDepreciation = (depreciableValue * (n - currentYear + 1)) / sumOfDigits;
              monthlyDepreciation = yearlyDepreciation / 12;
            }
            break;

          case 'DOUBLE_DECLINING_BALANCE':
            const bookValue = asset.cost - asset.accumulatedDepreciation;
            const straightLineRate = 1 / usefulLifeInMonths;
            const doubleDecliningRate = straightLineRate * 2;
            monthlyDepreciation = bookValue * doubleDecliningRate;
            
            if (asset.cost - (asset.accumulatedDepreciation + monthlyDepreciation) < asset.residualValue) {
              monthlyDepreciation = (asset.cost - asset.accumulatedDepreciation) - asset.residualValue;
            }
            break;
          
          case 'STRAIGHT_LINE':
          default:
            monthlyDepreciation = depreciableValue / usefulLifeInMonths;
            break;
        }
        
        const remainingValueToDepreciate = depreciableValue - asset.accumulatedDepreciation;
        const depreciationAmount = Math.max(0, Math.min(monthlyDepreciation, remainingValueToDepreciate));

        if (depreciationAmount > 0.005) {
          asset.accumulatedDepreciation += depreciationAmount;
          asset.bookValue = asset.cost - asset.accumulatedDepreciation;
          
          await transactionManager.save(asset);
          
          const entryDto: CreateJournalEntryDto = {
            date: depreciationDate.toISOString(),
            description: `Depreciación mensual para ${asset.name}`,
            journalId: depreciationJournal.id,
            lines: [
              { 
                accountId: settings.defaultDepreciationExpenseAccountId, 
                debit: depreciationAmount, 
                credit: 0, 
                description: 'Gasto depreciación',
                valuations: [{
                  ledgerId: defaultLedger.id,
                  debit: depreciationAmount,
                  credit: 0
                }]
              },
              { 
                accountId: settings.defaultAccumulatedDepreciationAccountId, 
                debit: 0, 
                credit: depreciationAmount, 
                description: 'Depreciación acumulada',
                valuations: [{
                  ledgerId: defaultLedger.id,
                  debit: 0,
                  credit: depreciationAmount
                }]
              },
            ]
          };

          if (!transactionManager.queryRunner) {
            throw new Error("QueryRunner is not available on this entity manager.");
          }
          await this.journalEntriesService.createWithQueryRunner(transactionManager.queryRunner, entryDto, organizationId);

          this.logger.log(`Depreciación de ${depreciationAmount.toFixed(2)} registrada para el activo ${asset.name} (ID: ${asset.id})`);
        }
      }
      this.logger.log(`Proceso de depreciación finalizado para la organización ${organizationId}.`);
    };

    if (manager) {
      await execute(manager);
    } else {
      await this.dataSource.transaction(execute);
    }
  }
}