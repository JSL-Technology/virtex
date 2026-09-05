
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { FiscalYear, FiscalYearStatus } from './entities/fiscal-year.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { addMonthsIso, toIsoMonth, todayIso } from '../common/dates';

@Injectable()
export class FiscalYearArchivingService {
  private readonly logger = new Logger(FiscalYearArchivingService.name);

  constructor(
    private readonly schedulerLock: SchedulerLockService,
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepository: Repository<FiscalYear>,
    @InjectRepository(Organization)
    private readonly orgRepository: Repository<Organization>,
    @InjectRepository(OrganizationSettings)
    private readonly orgSettingsRepository: Repository<OrganizationSettings>,
  ) {}




  @Cron('0 4 1 * *')
  async handleCron() {
    this.logger.log('Iniciando job de archivado de años fiscales...');
    const organizations = await this.orgRepository.find();
    
    const month = toIsoMonth(new Date());
    for (const org of organizations) {
      // Archiving marks years as archived, so a second replica running the same month would find
      // nothing to do — but the claim keeps the log honest and the work single-writer.
      await this.schedulerLock
        .runOnce('fiscal-year-archiving', `${org.id}:${month}`, () =>
          this.archiveForOrganization(org.id),
        )
        .catch((error) => {
          this.logger.error(
            `Archivado fallido para ${org.id}: ${(error as Error).message}`,
          );
        });
    }
  }

  private async archiveForOrganization(organizationId: string): Promise<void> {
    const settings = await this.orgSettingsRepository.findOneBy({ organizationId });
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