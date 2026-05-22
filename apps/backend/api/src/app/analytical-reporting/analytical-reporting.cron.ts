
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AnalyticalReportingService } from './analytical-reporting.service';

@Injectable()
export class AnalyticalReportingCron {
  private readonly logger = new Logger(AnalyticalReportingCron.name);

  constructor(private readonly reportingService: AnalyticalReportingService) {}


  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    this.logger.log('Iniciando job programado para refrescar la vista materializada.');
    try {
      await this.reportingService.refreshMaterializedView();
    } catch (error) {
      this.logger.error('Fallo el job de refresco de la vista materializada', error.stack);
    }
  }
}