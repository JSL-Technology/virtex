import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { SigningCertificate } from '../entities/signing-certificate.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { organizationFiscalIdentity } from '../../organizations/contracts/fiscal-identity.contract';
import { certificatePolicyFor } from '../contracts/certificate-policy';
import { assertStoredCertificateUsable } from './certificate-inspector';
import { CertificateVaultService } from './certificate-vault.service';
import { fiscalIdentifierLabel } from '../../markets';
import { BadRequestError } from '../../i18n/localized.exception';

/**
 * Whether this company can sign the electronic documents its market requires — asked before one is
 * issued, in every market whose regime signs with the taxpayer's own certificate.
 *
 * ## Why it is asked before the sale and not at transmission
 *
 * An electronic document that cannot be signed must not be issued: its number is spent and the
 * authority never receives it. This used to be checked only when the document was built, AFTER the
 * sale had committed — the invoice kept a number the authority would never see, and nothing on
 * screen said so. Raised here, the same condition blocks the issue preview, with the way to fix it.
 *
 * The rule is the same everywhere and reads the market's own declaration: the company has its
 * market's identifier, it holds an active certificate of that market's regime, and that certificate
 * may still sign for it (`certificatePolicyFor`, `assertStoredCertificateUsable`). Nothing here is
 * a Dominican assumption, and nothing here knows how any regime's document is built — that is the
 * regime adapter's business (`regimes/<cc>/`).
 */
@Injectable()
export class SigningReadinessService {
  constructor(
    @InjectRepository(SigningCertificate)
    private readonly certificates: Repository<SigningCertificate>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    private readonly vault: CertificateVaultService,
  ) {}

  /** Refuses to issue an electronic document this tenant cannot sign. */
  async assertReadyToSign(organizationId: string, manager?: EntityManager): Promise<void> {
    const identity = await organizationFiscalIdentity(manager ?? this.organizations.manager, organizationId);
    const policy = certificatePolicyFor(identity?.country);
    if (!identity || !policy) {
      throw new BadRequestError('einvoicing.certificate.no_regime', { country: identity?.country ?? '—' });
    }
    if (!identity.taxId) {
      throw new BadRequestError('einvoicing.certificate.organization_has_no_tax_id', {
        label: fiscalIdentifierLabel(policy.country),
      });
    }
    const certificate = await this.activeCertificate(organizationId, policy.regime, manager);
    if (!certificate) {
      throw new BadRequestError('einvoicing.certificate.none_active', { authority: policy.authority });
    }
    assertStoredCertificateUsable(certificate, { country: policy.country, taxId: identity.taxId }, policy, {
      allowTestCertificates: this.vault.testCertificatesAllowed(),
    });
  }

  /** The same question, as a yes or no: what the issue preview shows as a blocking condition. */
  async isReadyToSign(organizationId: string, manager?: EntityManager): Promise<boolean> {
    try {
      await this.assertReadyToSign(organizationId, manager);
      return true;
    } catch (error) {
      if (error instanceof BadRequestError) return false;
      throw error;
    }
  }

  /** The certificate that signs this regime's documents for the tenant, newest first. */
  private activeCertificate(
    organizationId: string,
    regime: string,
    manager?: EntityManager,
  ): Promise<SigningCertificate | null> {
    const repository = manager ? manager.getRepository(SigningCertificate) : this.certificates;
    return repository.findOne({
      where: { organizationId, isActive: true, regime },
      order: { createdAt: 'DESC' },
    });
  }
}
