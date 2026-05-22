
import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DepreciationService } from '../fixed-assets/depreciation.service';
import { CurrencyRevaluationService } from '../batch-processes/currency-revaluation.service';
import { AccountingPeriod } from './entities/accounting-period.entity';

@Injectable()
export class ClosingAutomationService {
  private readonly logger = new Logger(ClosingAutomationService.name);

  constructor(
    private readonly depreciationService: DepreciationService,
    private readonly currencyRevaluationService: CurrencyRevaluationService,
  ) {}

  async runPreClosingTasks(period: AccountingPeriod, organizationId: string, manager: EntityManager): Promise<void> {
    this.logger.log(`Ejecutando tareas de pre-cierre para el período ${period.name} en la organización ${organizationId}`);


    try {
      this.logger.log(`-> Iniciando depreciación de activos fijos...`);
      await this.depreciationService.runMonthlyDepreciation(organizationId, period.endDate, manager);
      this.logger.log(`-> Depreciación de activos fijos completada.`);
    } catch (error) {
      this.logger.error(`Error durante la depreciación automática para el período ${period.id}`, error.stack);
      throw new Error(`Fallo en la depreciación de activos fijos: ${error.message}`);
    }


    try {
      this.logger.log(`-> Iniciando revaluación de moneda extranjera...`);
      await this.currencyRevaluationService.run(period.endDate, organizationId, undefined, manager);
      this.logger.log(`-> Revaluación de moneda extranjera completada.`);
    } catch (error) {
      this.logger.error(`Error durante la revaluación de moneda para el período ${period.id}`, error.stack);
      throw new Error(`Fallo en la revaluación de moneda: ${error.message}`);
    }

    this.logger.log(`Todas las tareas de pre-cierre para el período ${period.name} se completaron exitosamente.`);
  }
}