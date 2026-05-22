
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { FiscalYear, FiscalYearStatus } from './entities/fiscal-year.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Organization } from '../organizations/entities/organization.entity';

@Injectable()
export class FiscalYearArchivingService {
  private readonly logger = new Logger(FiscalYearArchivingService.name);

  constructor(
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
    
    for (const org of organizations) {
      await this.archiveForOrganization(org.id);
    }
  }

  private async archiveForOrganization(organizationId: string): Promise<void> {
    const settings = await this.orgSettingsRepository.findOneBy({ organizationId });
    if (!settings) return;

    const archiveYears = settings.fiscalArchiveAfterYears;
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - archiveYears);

    const yearsToArchive = await this.fiscalYearRepository.find({
      where: {
        organizationId,
        status: FiscalYearStatus.CLOSED,
        endDate: LessThan(cutoffDate),
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