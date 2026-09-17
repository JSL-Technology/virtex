import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FiscalRegion } from './entities/fiscal-region.entity';
import { CoaTemplate } from './entities/coa-template.entity';
import { TaxTemplate } from './entities/tax-template.entity';
import { LocalizationTemplate } from './entities/localization-template.entity';
import { TaxGroup } from './entities/tax-group.entity';
import { LocalizationService } from './services/localization.service';
import { LocalizationProvisioningPort } from './localization-provisioning.port';
import { TaxScheme } from './entities/tax-scheme.entity';
import { FiscalDocumentTypeDefinition } from './entities/fiscal-document-type-definition.entity';
import { EInvoiceProviderConfig } from './entities/einvoice-provider-config.entity';
import { TaxJurisdiction } from './fiscal/entities/tax-jurisdiction.entity';
import { TenantWithholdingRegime } from './fiscal/entities/tenant-withholding-regime.entity';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
import { TaxesModule } from '../taxes/taxes.module';
import { SharedModule } from '../shared/shared.module';
import { HttpModule } from '@nestjs/axios';
import { AccountingModule } from '../accounting/accounting.module';
import { EinvoicingModule } from '../einvoicing/einvoicing.module';
import { DominicanRepublicStrategy } from './drivers/dominican-republic/dominican-republic.strategy';
import { GenericFiscalStrategy } from './drivers/generic-fiscal.strategy';
import { USStrategy } from './drivers/usa/usa.strategy';
import { TenantJurisdictionProvider } from './fiscal/tax-determination/tenant-jurisdiction.provider';
import { TaxDeterminationService } from './fiscal/tax-determination/tax-determination.service';

/**
 * Leaf module that exports `LocalizationProvisioningPort`.
 *
 * ## Why this exists
 *
 * `OrganizationsModule` needed two methods from `LocalizationService` for the subsidiary creation
 * flow: `findRegionByCountryCode()` and `applyFiscalPackage()`. Importing the full
 * `LocalizationModule` created a forwardRef cycle because `LocalizationModule` also imported
 * `OrganizationsModule` (for a controller endpoint). This is the same leaf-module pattern used
 * for `PeriodLockModule` and `DepreciationModule`.
 *
 * `OrganizationsModule` imports this leaf. `LocalizationModule` imports this leaf too (to reuse
 * `LocalizationService` without re-providing it) and re-exports the port.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      FiscalRegion,
      TaxScheme,
      LocalizationTemplate,
      CoaTemplate,
      TaxTemplate,
      TaxGroup,
      FiscalDocumentTypeDefinition,
      EInvoiceProviderConfig,
      TaxJurisdiction,
      TenantWithholdingRegime,
    ]),
    forwardRef(() => ChartOfAccountsModule),
    TaxesModule,
    SharedModule,
    HttpModule,
    AccountingModule,
    EinvoicingModule,
  ],
  providers: [
    LocalizationService,
    DominicanRepublicStrategy,
    GenericFiscalStrategy,
    USStrategy,
    TenantJurisdictionProvider,
    TaxDeterminationService,
    { provide: LocalizationProvisioningPort, useExisting: LocalizationService },
  ],
  exports: [LocalizationProvisioningPort, LocalizationService, TaxDeterminationService],
})
export class LocalizationProvisioningModule {}
