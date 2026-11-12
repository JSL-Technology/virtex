import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FiscalDocumentEvent } from './entities/fiscal-document-event.entity';
import { SigningCertificate } from './entities/signing-certificate.entity';
import { FiscalDocumentRange } from './entities/fiscal-document-range.entity';
import { FiscalRegimeSettings } from './entities/fiscal-regime-settings.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { CertificateVaultService } from './services/certificate-vault.service';
import { EcfSignerService } from './regimes/do/ecf-signer.service';
import { EcfXmlBuilderService } from './regimes/do/ecf-xml-builder.service';
import { EcfValidatorService } from './regimes/do/ecf-validator.service';
import { DgiiConfigService } from './regimes/do/dgii-config.service';
import { DgiiAuthService } from './regimes/do/dgii-auth.service';
import { DgiiTransportService } from './regimes/do/dgii-transport.service';
import { SigningReadinessService } from './services/signing-readiness.service';
import { SigningCertificateService } from './services/signing-certificate.service';
import { DgiiEventXmlBuilder } from './regimes/do/dgii-event-xml.builder';
import { DgiiDocumentEventsService } from './regimes/do/dgii-document-events.service';
import { FiscalDocumentEventsService } from './services/fiscal-document-events.service';
import { SharedModule } from '../shared/shared.module';
import { EinvoicingController } from './einvoicing.controller';
import { FiscalRangeService } from './services/fiscal-range.service';
import { FiscalRegimeSettingsService } from './services/fiscal-regime-settings.service';
import { XmlSignatureService } from './regimes/xml-signature.service';
import { RegimeTransportService } from './regimes/regime-transport.service';
import { FiscalRegimeRegistry } from './regimes/fiscal-regime.registry';
import { CfdiRegimeAdapter } from './regimes/mx/cfdi.adapter';
import { PacProvider } from './regimes/mx/pac.provider';
import { DianRegimeAdapter } from './regimes/co/dian.adapter';
import { SunatRegimeAdapter } from './regimes/pe/sunat.adapter';
import { SriRegimeAdapter } from './regimes/ec/sri.adapter';
import { SiiRegimeAdapter } from './regimes/cl/sii.adapter';
import { NfeRegimeAdapter } from './regimes/br/nfe.adapter';
import { AfipRegimeAdapter } from './regimes/ar/afip.adapter';
import { DgiiRegimeAdapter } from './regimes/do/dgii.adapter';
import { FiscalSubmission } from './entities/fiscal-submission.entity';
import { TransmissionConfigService } from './services/transmission-config.service';
import { FiscalSubmissionService } from './services/fiscal-submission.service';
import { FiscalSubmissionReconciler } from './services/fiscal-submission.reconciler';

/**
 * Electronic invoicing, for every market whose authority has a regime: the certificate vault, the
 * regime adapters (each building and sealing its authority's own document), one outbox that
 * transmits and reconciles them all, and the tenant-facing API.
 *
 * The Dominican e-CF is one of those regimes now (`regimes/do/`). It used to be the module's
 * subject, with a pipeline, a table and a reconciler of its own while six other regimes shared
 * another — two answers to «where does this document stand with its authority», depending on the
 * country.
 *
 * It also covers the two DGII messages that are part of the cycle without being comprobantes — the
 * commercial approval a buyer owes its suppliers, and the annulment of authorized numbers that will
 * never be used. Both had transport code and endpoints but no builder, no signature and no route.
 */
@Module({
  imports: [
    // `TenantCountryResolver`: which market's regime answers for this tenant.
    SharedModule,
    TypeOrmModule.forFeature([
      FiscalDocumentEvent,
      SigningCertificate,
      Invoice,
      Organization,
      OrganizationSettings,
      FiscalDocumentRange,
      FiscalRegimeSettings,
      FiscalSubmission,
    ]),
  ],
  // FiscalRegimeSettingsController lives in EinvoicingAdminModule: it needs AuthModule (step-up),
  // and AuthModule reaches this module, so importing it here would close a cycle.
  controllers: [EinvoicingController],
  providers: [
    CertificateVaultService,
    EcfSignerService,
    EcfXmlBuilderService,
    EcfValidatorService,
    DgiiConfigService,
    DgiiAuthService,
    DgiiTransportService,
    SigningReadinessService,
    SigningCertificateService,
    DgiiEventXmlBuilder,
    DgiiDocumentEventsService,
    FiscalDocumentEventsService,
    // The regime backbone. `XmlSignatureService` and `RegimeTransportService` were written,
    // tested and left unregistered, which is why every market but the Dominican Republic still
    // resolved to the generic adapter: the code existed and the container had never heard of it.
    FiscalRangeService,
    FiscalRegimeSettingsService,
    XmlSignatureService,
    RegimeTransportService,
    // The regimes themselves. Until they were registered here the container had never heard of
    // them: the builders were tested standalone and nothing could reach them at issuance, which is
    // exactly what H18 describes.
    PacProvider,
    DgiiRegimeAdapter,
    CfdiRegimeAdapter,
    DianRegimeAdapter,
    SunatRegimeAdapter,
    SriRegimeAdapter,
    SiiRegimeAdapter,
    NfeRegimeAdapter,
    AfipRegimeAdapter,
    FiscalRegimeRegistry,
    TransmissionConfigService,
    FiscalSubmissionService,
    FiscalSubmissionReconciler,
  ],
  exports: [
    SigningReadinessService,
    SigningCertificateService,
    EcfXmlBuilderService,
    EcfValidatorService,
    DgiiDocumentEventsService,
    FiscalRangeService,
    XmlSignatureService,
    RegimeTransportService,
    FiscalRegimeRegistry,
    TransmissionConfigService,
    FiscalSubmissionService,
    FiscalRegimeSettingsService,
  ],
})
export class EinvoicingModule {}
