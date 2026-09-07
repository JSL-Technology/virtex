
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { LocalizationService } from './services/localization.service';
import { FiscalRegion } from './entities/fiscal-region.entity';
import { TaxScheme } from './entities/tax-scheme.entity';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
import { TaxesModule } from '../taxes/taxes.module';
import { LocalizationTemplate } from './entities/localization-template.entity';
import { CoaTemplate } from './entities/coa-template.entity';
import { TaxTemplate } from './entities/tax-template.entity';
import { SharedModule } from '../shared/shared.module';
import { TaxGroup } from './entities/tax-group.entity';
import { ReportDefinition } from './entities/report-definition.entity';
import { FiscalDocumentTypeDefinition } from './entities/fiscal-document-type-definition.entity';
import { EInvoiceProviderConfig } from './entities/einvoice-provider-config.entity';
import { LocalizationController } from './controllers/localization.controller';
import { DominicanRepublicStrategy } from './drivers/dominican-republic/dominican-republic.strategy';
import { GenericFiscalStrategy } from './drivers/generic-fiscal.strategy';
import { USStrategy } from './drivers/usa/usa.strategy';
import { TaxJurisdiction } from './fiscal/entities/tax-jurisdiction.entity';
import { TaxDeterminationService } from './fiscal/tax-determination/tax-determination.service';
import { TenantJurisdictionProvider } from './fiscal/tax-determination/tenant-jurisdiction.provider';
import { TaxJurisdictionsController } from './controllers/tax-jurisdictions.controller';
import { TaxJurisdictionsService } from './services/tax-jurisdictions.service';
import { TenantWithholdingRegime } from './fiscal/entities/tenant-withholding-regime.entity';
import { WithholdingRegimesService } from './services/withholding-regimes.service';
import { WithholdingRegimesController } from './controllers/withholding-regimes.controller';
import { RegimeTransportService } from '../einvoicing/regimes/regime-transport.service';
import { XmlSignatureService } from '../einvoicing/regimes/xml-signature.service';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FiscalRegion,
      TaxScheme,
      LocalizationTemplate,
      CoaTemplate,
      TaxTemplate,
      TaxGroup,
      ReportDefinition,
      FiscalDocumentTypeDefinition,
      EInvoiceProviderConfig,
      TaxJurisdiction,
      TenantWithholdingRegime,
    ]),
    // The 'localization' queue and its consumer are gone. Nothing ever enqueued a job onto it,
    // and the consumer's handler looped over the chart-of-accounts and tax templates with empty
    // bodies — so provisioning appeared to be asynchronous and queue-backed while actually being
    // done synchronously by `LocalizationService.applyFiscalPackage`. Two mechanisms, one real.
    forwardRef(() => ChartOfAccountsModule),
    TaxesModule,
    SharedModule,
    HttpModule,
    // The coverage endpoint reads the tenant's country.
    forwardRef(() => OrganizationsModule),
  ],
  providers: [
    LocalizationService,
    DominicanRepublicStrategy,
    USStrategy,
    GenericFiscalStrategy,
    // Sales tax in the markets with no national rate: the United States, Brazil.
    TenantJurisdictionProvider,
    TaxDeterminationService,
    TaxJurisdictionsService,
    WithholdingRegimesService,
    // Shared by every e-invoicing regime: one signature suite and one transport, configured per
    // market rather than reimplemented per market.
    XmlSignatureService,
    RegimeTransportService,
  ],
  controllers: [
    LocalizationController,
    TaxJurisdictionsController,
    WithholdingRegimesController,
  ],
  exports: [LocalizationService, TaxDeterminationService, XmlSignatureService, RegimeTransportService],
})
export class LocalizationModule {}
