import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EcfSubmission } from './entities/ecf-submission.entity';
import { EcfLifecycleMessage } from './entities/ecf-lifecycle-message.entity';
import { EcfCertificate } from './entities/ecf-certificate.entity';
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
  ],
  exports: [
    EcfSubmissionService,
    EcfCertificateService,
    EcfXmlBuilderService,
    EcfValidatorService,
    EcfLifecycleService,
  ],
})
export class EinvoicingModule {}
