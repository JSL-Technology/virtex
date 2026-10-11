
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { FiscalYear, FiscalYearStatus } from './entities/fiscal-year.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { forEachTenant } from '../shared/tenancy/tenant-job';
import { addMonthsIso, toIsoMonth, todayIso } from '../common/dates';

@Injectable()
export class FiscalYearArchivingService {
  private readonly logger = new Logger(FiscalYearArchivingService.name);

  constructor(
    private readonly schedulerLock: SchedulerLockService,
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepository: Repository<FiscalYear>,
    private readonly dataSource: DataSource,
  ) {}




  @Cron('0 4 1 * *')
  async handleCron() {
    this.logger.log('Iniciando job de archivado de años fiscales...');
    const month = toIsoMonth(new Date());
    // Each tenant in its own context: fiscal years and settings are behind the row-level policies.
    await forEachTenant(this.dataSource, async (organizationId) => {
      // Archiving marks years as archived, so a second replica running the same month would find
      // nothing to do — but the claim keeps the log honest and the work single-writer.
      await this.schedulerLock
        .runOnce('fiscal-year-archiving', `${organizationId}:${month}`, () =>
          this.archiveForOrganization(organizationId),
        )
        .catch((error) => {
          this.logger.error(`Fiscal-year archiving failed for ${organizationId}: ${(error as Error).message}`);
        });
    });
  }

  private async archiveForOrganization(organizationId: string): Promise<void> {
    const settings = await this.dataSource.getRepository(OrganizationSettings).findOneBy({ organizationId });
    if (!settings) return;

    const archiveYears = settings.fiscalArchiveAfterYears;
    // A calendar cut-off on a `date` column, in UTC. `new Date()` plus `setFullYear` reads the
    // server's local calendar, which moves the boundary by a day either side of midnight.
    const cutoffDate = addMonthsIso(todayIso(), -12 * archiveYears);

    const yearsToArchive = await this.fiscalYearRepository.find({
      where: {
        organizationId,
        status: FiscalYearStatus.CLOSED,
        endDate: LessThan(cutoffDate as unknown as Date),
      },
    });

    if (yearsToArchive.length > 0) {
      this.logger.log(`Archivando ${yearsToArchive.length} año(s) fiscal(es) para la organización ${organizationId}.`);
      for (const year of yearsToArchive) {
        year.status = FiscalYearStatus.LOCKED;
      }
      await this.fiscalYearRepository.save(yearsToArchive);
    }
  }
}