
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
import { LocalizationListener } from './listeners/localization.listener';
import { DominicanRepublicStrategy } from './drivers/dominican-republic/dominican-republic.strategy';
import { GenericFiscalStrategy } from './drivers/generic-fiscal.strategy';
import { USStrategy } from './drivers/usa/usa.strategy';

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
    ]),
    // The 'localization' queue and its consumer are gone. Nothing ever enqueued a job onto it,
    // and the consumer's handler looped over the chart-of-accounts and tax templates with empty
    // bodies — so provisioning appeared to be asynchronous and queue-backed while actually being
    // done synchronously by `LocalizationService.applyFiscalPackage`. Two mechanisms, one real.
    forwardRef(() => ChartOfAccountsModule),
    TaxesModule,
    SharedModule,
    HttpModule
  ],
  providers: [
    LocalizationService,
    LocalizationListener,
    DominicanRepublicStrategy,
    USStrategy,
    GenericFiscalStrategy
  ],
  controllers: [LocalizationController],
  exports: [LocalizationService],
})
export class LocalizationModule {}
