
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
    ]),
    // The 'localization' queue and its consumer are gone. Nothing ever enqueued a job onto it,
    // and the consumer's handler looped over the chart-of-accounts and tax templates with empty
    // bodies — so provisioning appeared to be asynchronous and queue-backed while actually being
    // done synchronously by `LocalizationService.applyFiscalPackage`. Two mechanisms, one real.
    forwardRef(() => ChartOfAccountsModule),
    TaxesModule,
    SharedModule,
    HttpModule,
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
  ],
  controllers: [LocalizationController, TaxJurisdictionsController],
  exports: [LocalizationService, TaxDeterminationService],
})
export class LocalizationModule {}
