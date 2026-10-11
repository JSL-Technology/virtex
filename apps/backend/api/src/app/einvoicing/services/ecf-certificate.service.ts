import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EcfCertificate } from '../entities/ecf-certificate.entity';
import { CertificateVaultService } from './certificate-vault.service';
import { BadRequestError } from '../../i18n/localized.exception';
import { assessCertificate } from './certificate-inspector';
import { certificatePolicyFor, certificatePolicyForRegime } from '../contracts/certificate-policy';
import { TaxpayerKind, identityDocumentLabel } from '../../localization/contracts/tax-id.contract';
import { organizationFiscalIdentity } from '../../organizations/contracts/fiscal-identity.contract';

/** Certificate view without any encrypted material — safe to return over the API. */
export interface EcfCertificateView {
  id: string;
  alias: string;
  subjectCommonName?: string;
  serialNumber?: string;
  notBefore?: Date;
  notAfter?: Date;
  /** The regime it signs for (`DGII`, `CFDI`, `DIAN`…): one active certificate per regime. */
  regime: string;
  /** The identifier the certificate was issued to: the company's, or its representative's. */
  holderTaxId?: string | null;
  holderKind?: 'company' | 'person' | null;
  /** The name of that identifier in the regime's market: `RNC`, `Cédula`, `RFC`, `NIT`… */
  holderIdLabel?: string | null;
  /** The tax authority the certificate signs for: `DGII`, `SAT`, `DIAN`… */
  authority?: string | null;
  issuerCommonName?: string | null;
  /** Self-signed test certificate (development only). */
  isTest: boolean;
  isActive: boolean;
  expired: boolean;
  createdAt: Date;
}

/**
 * Manages a tenant's signing certificates in any market with an electronic-invoicing regime:
 * validates the PKCS#12 and password up front, checks that it is the company's (or, where the
 * market allows it, its representative's), encrypts it at rest through the vault, and keeps
 * exactly one active certificate per regime.
 *
 * The regime is the company's market's (`certificatePolicyFor`). Every certificate used to be
 * filed as a DGII one, so a Mexican CSD was stored where the CFDI adapter never looks.
 */
@Injectable()
export class EcfCertificateService {
  constructor(
    @InjectRepository(EcfCertificate)
    private readonly repo: Repository<EcfCertificate>,
    private readonly vault: CertificateVaultService,
  ) {}

  async upload(
    organizationId: string,
    input: { pfx: Buffer; password: string; alias: string },
  ): Promise<EcfCertificateView> {
    if (!input.pfx?.length) throw new BadRequestError('einvoicing.certificate.file_empty');
    if (!input.password) throw new BadRequestError('einvoicing.certificate.password_required');

    // Which regime the certificate signs for is the company's market's; a market with no regime
    // has nothing to sign, and a certificate stored for it would never be used.
    const identity = await organizationFiscalIdentity(this.repo.manager, organizationId);
    const policy = certificatePolicyFor(identity?.country);
    if (!identity || !policy) {
      throw new BadRequestError('einvoicing.certificate.no_regime', { country: identity?.country ?? '—' });
    }

    // Validate before persisting — a bad password / malformed file throws here, not at signing time.
    const parsed = this.vault.parsePkcs12(input.pfx, input.password);

    // And that it is THIS company's: in force, able to sign, issued by an authority, to its
    // identifier or, where the market allows it, to its representative — not another company's
    // file (QA V01).
    const assessment = assessCertificate(
      parsed.facts,
      { country: policy.country, taxId: identity.taxId },
      policy,
      { allowTestCertificates: this.vault.testCertificatesAllowed() },
    );

    return this.repo.manager.transaction(async (manager) => {
      // Only this regime's certificate is replaced. Deactivating every active certificate of the
      // tenant meant that loading a Mexican CSD switched off the DGII certificate, and the next
      // Dominican document could not be signed.
      await manager
        .getRepository(EcfCertificate)
        .update({ organizationId, regime: policy.regime, isActive: true }, { isActive: false });

      const entity = manager.create(EcfCertificate, {
        organizationId,
        regime: policy.regime,
        alias: input.alias || parsed.subjectCommonName || `${policy.authority} ${parsed.serialNumber ?? ''}`.trim(),
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
    const policy = certificatePolicyForRegime(c.regime);
    const holderIdLabel =
      policy && c.holderKind
        ? identityDocumentLabel(
            policy.country,
            c.holderKind === 'person' ? TaxpayerKind.INDIVIDUAL : TaxpayerKind.COMPANY,
          )
        : null;
    return {
      id: c.id,
      alias: c.alias,
      regime: c.regime,
      subjectCommonName: c.subjectCommonName,
      serialNumber: c.serialNumber,
      notBefore: c.notBefore,
      notAfter: c.notAfter,
      holderTaxId: c.holderTaxId ?? null,
      holderKind: c.holderKind ?? null,
      holderIdLabel,
      authority: policy?.authority ?? null,
      issuerCommonName: c.issuerCommonName ?? null,
      isTest: c.isTest ?? false,
      isActive: c.isActive,
      expired: c.notAfter ? c.notAfter.getTime() < Date.now() : false,
      createdAt: c.createdAt,
    };
  }
}
