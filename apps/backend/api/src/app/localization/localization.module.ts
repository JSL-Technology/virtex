
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportDefinition } from './entities/report-definition.entity';
import { TaxJurisdiction } from './fiscal/entities/tax-jurisdiction.entity';
import { TenantWithholdingRegime } from './fiscal/entities/tenant-withholding-regime.entity';
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
    // TaxJurisdictionsService and WithholdingRegimesService are declared here, so their
    // repositories must live in this module's context. The provisioning leaf registers the same
    // entities for its own use but does not re-export TypeOrmModule, so those repository providers
    // were invisible here and Nest could not resolve either service (`can't resolve ...
    // TaxJurisdictionRepository ... in the LocalizationModule context`).
    TypeOrmModule.forFeature([
      ReportDefinition,
      TaxJurisdiction,
      TenantWithholdingRegime,
    ]),
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
