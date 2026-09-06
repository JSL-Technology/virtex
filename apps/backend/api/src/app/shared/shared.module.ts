






import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSequence } from './document-sequences/entities/document-sequence.entity';
import { DocumentSequencesService } from './document-sequences/document-sequences.service';
import { CryptoUtil } from './utils/crypto.util';
import { TenantBookkeepingProvisioner } from './provisioning/tenant-bookkeeping.provisioner';
import { AfterCommitService } from './after-commit/after-commit.service';
import { FiscalCalendarService } from './fiscal-calendar.service';
import { Organization } from '../organizations/entities/organization.entity';
import { FiscalYear } from '../accounting/entities/fiscal-year.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentSequence, Organization, FiscalYear])
  ], 
  providers: [
    DocumentSequencesService,
    CryptoUtil,
    TenantBookkeepingProvisioner,
    AfterCommitService,
    FiscalCalendarService,
  ],
  exports: [
    DocumentSequencesService,
    CryptoUtil,
    TenantBookkeepingProvisioner,
    AfterCommitService,
    FiscalCalendarService,
  ],
})
export class SharedModule {}