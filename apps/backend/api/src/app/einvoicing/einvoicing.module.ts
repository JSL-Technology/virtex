import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EcfSubmission } from './entities/ecf-submission.entity';
import { EcfCertificate } from './entities/ecf-certificate.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { AuthModule } from '../auth/auth.module';
import { CertificateVaultService } from './services/certificate-vault.service';
import { EcfSignerService } from './services/ecf-signer.service';
import { EcfXmlBuilderService } from './services/ecf-xml-builder.service';
import { DgiiConfigService } from './services/dgii-config.service';
import { DgiiAuthService } from './services/dgii-auth.service';
import { DgiiTransportService } from './services/dgii-transport.service';
import { EcfSubmissionService } from './services/ecf-submission.service';
import { EcfCertificateService } from './services/ecf-certificate.service';
import { EcfReconcilerService } from './services/ecf-reconciler.service';
import { EinvoicingController } from './einvoicing.controller';

/**
 * Electronic invoicing (e-CF) for the Dominican Republic: certificate vault, DGII authentication,
 * XML generation + XMLDSig signing, transmission, status reconciliation and the tenant-facing API.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([EcfSubmission, EcfCertificate, Invoice, Organization]),
    AuthModule,
  ],
  controllers: [EinvoicingController],
  providers: [
    CertificateVaultService,
    EcfSignerService,
    EcfXmlBuilderService,
    DgiiConfigService,
    DgiiAuthService,
    DgiiTransportService,
    EcfSubmissionService,
    EcfCertificateService,
    EcfReconcilerService,
  ],
  exports: [EcfSubmissionService, EcfCertificateService],
})
export class EinvoicingModule {}
