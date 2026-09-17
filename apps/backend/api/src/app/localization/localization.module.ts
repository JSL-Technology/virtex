
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportDefinition } from './entities/report-definition.entity';
import { LocalizationController } from './controllers/localization.controller';
import { TaxJurisdictionsController } from './controllers/tax-jurisdictions.controller';
import { TaxJurisdictionsService } from './services/tax-jurisdictions.service';
import { WithholdingRegimesService } from './services/withholding-regimes.service';
import { WithholdingRegimesController } from './controllers/withholding-regimes.controller';
import { EinvoicingModule } from '../einvoicing/einvoicing.module';
// The leaf provides LocalizationService, DominicanRepublicStrategy, fiscal strategies,
// TaxDeterminationService, and the LocalizationProvisioningPort binding. Re-exporting it here
// means all consumers of LocalizationModule continue to see those same exports.
import { LocalizationProvisioningModule } from './localization-provisioning.module';

@Module({
  imports: [
    // Report definitions are owned by LocalizationModule, not by the leaf.
    TypeOrmModule.forFeature([ReportDefinition]),
    // The leaf provides all strategies, LocalizationService, TaxDeterminationService.
    LocalizationProvisioningModule,
    EinvoicingModule,
  ],
  providers: [
    TaxJurisdictionsService,
    WithholdingRegimesService,
  ],
  controllers: [
    LocalizationController,
    TaxJurisdictionsController,
    WithholdingRegimesController,
  ],
  // LocalizationProvisioningModule re-exports LocalizationService, TaxDeterminationService,
  // and LocalizationProvisioningPort — all available to consumers of LocalizationModule.
  exports: [LocalizationProvisioningModule],
})
export class LocalizationModule {}
