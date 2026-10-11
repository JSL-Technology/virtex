import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DGII_CERTIFICATE_REGIME, EcfCertificate } from '../entities/ecf-certificate.entity';
import { CertificateVaultService } from './certificate-vault.service';
import { BadRequestError } from '../../i18n/localized.exception';
import { assessCertificate } from './certificate-inspector';
import { EcfSubmissionService } from './ecf-submission.service';

/** Certificate view without any encrypted material — safe to return over the API. */
export interface EcfCertificateView {
  id: string;
  alias: string;
  subjectCommonName?: string;
  serialNumber?: string;
  notBefore?: Date;
  notAfter?: Date;
  /** RNC or cédula the certificate was issued to. */
  holderTaxId?: string | null;
  holderKind?: 'company' | 'person' | null;
  issuerCommonName?: string | null;
  /** Self-signed test certificate (development only). */
  isTest: boolean;
  isActive: boolean;
  expired: boolean;
  createdAt: Date;
}

/**
 * Manages a tenant's DGII signing certificates: validates the PKCS#12 and password up front,
 * encrypts them at rest through the vault, and keeps exactly one active certificate per tenant.
 */
@Injectable()
export class EcfCertificateService {
  constructor(
    @InjectRepository(EcfCertificate)
    private readonly repo: Repository<EcfCertificate>,
    private readonly vault: CertificateVaultService,
    private readonly submissions: EcfSubmissionService,
  ) {}

  async upload(
    organizationId: string,
    input: { pfx: Buffer; password: string; alias: string },
  ): Promise<EcfCertificateView> {
    if (!input.pfx?.length) throw new BadRequestError('einvoicing.do.certificate_file_empty');
    if (!input.password) throw new BadRequestError('einvoicing.do.certificate_password_required');

    // Validate before persisting — a bad password / malformed file throws here, not at signing time.
    const parsed = this.vault.parsePkcs12(input.pfx, input.password);

    // And that it is THIS company's: in force, able to sign, issued by an authority, to its RNC or
    // to the cédula of a person — not another company's file (QA V01).
    const assessment = assessCertificate(parsed.facts, await this.submissions.organizationTaxId(organizationId), {
      allowTestCertificates: this.vault.testCertificatesAllowed(),
    });

    return this.repo.manager.transaction(async (manager) => {
      // Only this regime's certificate is replaced. Deactivating every active certificate of the
      // tenant meant that loading a Mexican CSD switched off the DGII certificate, and the next
      // Dominican document could not be signed.
      await manager
        .getRepository(EcfCertificate)
        .update({ organizationId, regime: DGII_CERTIFICATE_REGIME, isActive: true }, { isActive: false });

      const entity = manager.create(EcfCertificate, {
        organizationId,
        regime: DGII_CERTIFICATE_REGIME,
        alias: input.alias || parsed.subjectCommonName || 'Certificado DGII',
        encryptedPfx: this.vault.encrypt(input.pfx),
        encryptedPassword: this.vault.encrypt(input.password),
        subjectCommonName: parsed.subjectCommonName,
        serialNumber: parsed.serialNumber,
        notBefore: parsed.notBefore,
        notAfter: parsed.notAfter,
        holderTaxId: assessment.holderTaxId,
        holderKind: assessment.holderKind,
        issuerCommonName: parsed.facts.issuerCommonName,
        isTest: assessment.test,
        isActive: true,
      });
      const saved = await manager.save(entity);
      return this.toView(saved);
    });
  }

  async list(organizationId: string): Promise<EcfCertificateView[]> {
    const rows = await this.repo.find({ where: { organizationId }, order: { createdAt: 'DESC' } });
    return rows.map((r) => this.toView(r));
  }

  async deactivate(organizationId: string, id: string): Promise<void> {
    await this.repo.update({ id, organizationId }, { isActive: false });
  }

  private toView(c: EcfCertificate): EcfCertificateView {
    return {
      id: c.id,
      alias: c.alias,
      subjectCommonName: c.subjectCommonName,
      serialNumber: c.serialNumber,
      notBefore: c.notBefore,
      notAfter: c.notAfter,
      holderTaxId: c.holderTaxId ?? null,
      holderKind: c.holderKind ?? null,
      issuerCommonName: c.issuerCommonName ?? null,
      isTest: c.isTest ?? false,
      isActive: c.isActive,
      expired: c.notAfter ? c.notAfter.getTime() < Date.now() : false,
      createdAt: c.createdAt,
    };
  }
}
