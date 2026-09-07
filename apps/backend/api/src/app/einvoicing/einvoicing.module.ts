import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EcfSubmission } from './entities/ecf-submission.entity';
import { EcfLifecycleMessage } from './entities/ecf-lifecycle-message.entity';
import { EcfCertificate } from './entities/ecf-certificate.entity';
import { FiscalDocumentRange } from './entities/fiscal-document-range.entity';
import { FiscalRegimeSettings } from './entities/fiscal-regime-settings.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { NcfSequence } from '../compliance/entities/ncf-sequence.entity';
import { AuthModule } from '../auth/auth.module';
import { CertificateVaultService } from './services/certificate-vault.service';
import { EcfSignerService } from './services/ecf-signer.service';
import { EcfXmlBuilderService } from './services/ecf-xml-builder.service';
import { EcfValidatorService } from './services/ecf-validator.service';
import { DgiiConfigService } from './services/dgii-config.service';
import { DgiiAuthService } from './services/dgii-auth.service';
import { DgiiTransportService } from './services/dgii-transport.service';
import { EcfSubmissionService } from './services/ecf-submission.service';
import { EcfCertificateService } from './services/ecf-certificate.service';
import { EcfReconcilerService } from './services/ecf-reconciler.service';
import { EcfLifecycleXmlBuilder } from './services/ecf-lifecycle-xml.builder';
import { EcfLifecycleService } from './services/ecf-lifecycle.service';
import { EinvoicingController } from './einvoicing.controller';
import { FiscalRangeService } from './services/fiscal-range.service';
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

/**
 * Electronic invoicing (e-CF) for the Dominican Republic: certificate vault, DGII authentication,
 * XML generation + XMLDSig signing, transmission, status reconciliation and the tenant-facing API.
 *
 * It also covers the two messages that are part of the cycle without being comprobantes — the
 * commercial approval a buyer owes its suppliers, and the annulment of authorized numbers that will
 * never be used. Both had transport code and endpoints but no builder, no signature and no route.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      EcfSubmission,
      EcfLifecycleMessage,
      EcfCertificate,
      Invoice,
      Organization,
      OrganizationSettings,
      NcfSequence,
      FiscalDocumentRange,
      FiscalRegimeSettings,
    ]),
    AuthModule,
  ],
  controllers: [EinvoicingController],
  providers: [
    CertificateVaultService,
    EcfSignerService,
    EcfXmlBuilderService,
    EcfValidatorService,
    DgiiConfigService,
    DgiiAuthService,
    DgiiTransportService,
    EcfSubmissionService,
    EcfCertificateService,
    EcfReconcilerService,
    EcfLifecycleXmlBuilder,
    EcfLifecycleService,
    // The seven-regime backbone. `XmlSignatureService` and `RegimeTransportService` were written,
    // tested and left unregistered, which is why every market but the Dominican Republic still
    // resolved to the generic adapter: the code existed and the container had never heard of it.
    FiscalRangeService,
    XmlSignatureService,
    RegimeTransportService,
    // The seven regimes themselves. Until they were registered here the container had never heard
    // of them: the builders were tested standalone and nothing could reach them at issuance, which
    // is exactly what H18 describes.
    PacProvider,
    CfdiRegimeAdapter,
    DianRegimeAdapter,
    SunatRegimeAdapter,
    SriRegimeAdapter,
    SiiRegimeAdapter,
    NfeRegimeAdapter,
    AfipRegimeAdapter,
    FiscalRegimeRegistry,
  ],
  exports: [
    EcfSubmissionService,
    EcfCertificateService,
    EcfXmlBuilderService,
    EcfValidatorService,
    EcfLifecycleService,
    FiscalRangeService,
    XmlSignatureService,
    RegimeTransportService,
    FiscalRegimeRegistry,
  ],
})
export class EinvoicingModule {}
