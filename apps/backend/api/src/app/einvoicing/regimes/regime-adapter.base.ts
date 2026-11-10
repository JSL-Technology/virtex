import { EntityManager } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { EcfCertificate } from '../entities/ecf-certificate.entity';
import {
  FiscalEnvironment,
  FiscalRegimeSettings,
} from '../entities/fiscal-regime-settings.entity';
import { CertificateVaultService, LoadedCertificate } from '../services/certificate-vault.service';
import { FiscalRegimeContext, RegimeNotConfigured } from './fiscal-regime.types';
import { BadRequestError } from '../../i18n/localized.exception';

/**
 * The parts every regime adapter needs before it can build anything: the issuer, the buyer, the
 * taxpayer's certificate and the tenant's regime configuration.
 *
 * Extracted because six adapters resolving the same four things six ways is six chances for one of
 * them to forget that a missing certificate is a settings problem (`RegimeNotConfigured`) and not
 * a defective document. What is deliberately NOT here is anything about the document itself: the
 * schema, the signature profile and the transport differ per authority and generalising them would
 * produce a document that is nearly right in seven countries.
 */
export abstract class RegimeAdapterBase {
  protected constructor(
    protected readonly certificates: { regime: string },
    protected readonly vault: CertificateVaultService,
  ) {}

  /** The tenant's active certificate for this regime, decrypted for the length of one signature. */
  protected async certificateFor(
    context: FiscalRegimeContext,
    regimeName: string,
    missing: string,
  ): Promise<LoadedCertificate & { serialNumber?: string }> {
    const stored = await context.manager.findOne(EcfCertificate, {
      where: {
        organizationId: context.organizationId,
        regime: this.certificates.regime,
        isActive: true,
      },
      order: { createdAt: 'DESC' },
    });
    if (!stored) throw new RegimeNotConfigured(regimeName, missing);
    return this.vault.load(stored);
  }

  protected async organizationOf(context: FiscalRegimeContext): Promise<Organization> {
    const organization = await context.manager.findOne(Organization, {
      where: { id: context.organizationId },
    });
    if (!organization) {
      throw new BadRequestError('einvoicing.issuing_organization_not_found');
    }
    return organization;
  }

  protected async customerOf(context: FiscalRegimeContext): Promise<Customer> {
    const customer = await context.manager.findOne(Customer, {
      where: { id: context.invoice.customerId, organizationId: context.organizationId },
    });
    if (!customer) {
      throw new BadRequestError('einvoicing.receiving_customer_not_found');
    }
    return customer;
  }

  /**
   * The tenant's configuration for this regime.
   *
   * Absent, the caller decides whether that is fatal: Chile needs the activity code and cannot
   * proceed, Colombia's resolution number is only written on the document. So this returns null
   * rather than throwing, and each adapter refuses on what it actually needs.
   */
  protected async settingsOf(
    manager: EntityManager,
    organizationId: string,
    countryCode: string,
  ): Promise<FiscalRegimeSettings | null> {
    return manager.findOne(FiscalRegimeSettings, {
      where: { organizationId, countryCode },
    });
  }

  /**
   * The authority's own coding of production versus certification.
   *
   * Stored normalised precisely because these disagree. Colombia's DIAN writes `1` for production
   * and `2` for tests; **Ecuador's SRI writes `1` for tests and `2` for production**. A single
   * stored digit shared between them files Ecuadorean documents into the wrong world, and a
   * document filed against the test environment has no fiscal effect at all — which the taxpayer
   * discovers when an inspector asks for it.
   */
  protected environmentCode(
    settings: FiscalRegimeSettings | null,
    coding: { production: string; certification: string },
  ): string {
    const environment = settings?.environment ?? FiscalEnvironment.CERTIFICATION;
    return environment === FiscalEnvironment.PRODUCTION ? coding.production : coding.certification;
  }

  /**
   * The consecutive the document's number was drawn as, recorded when it was drawn
   * (`invoices.fiscal_sequence`) — never parsed back out of the formatted number, whose shape is
   * the market's mask and whose series may carry digits of its own.
   */
  protected assignedNumber(context: FiscalRegimeContext, regimeName: string): number {
    const sequence = Number(context.invoice.fiscalSequence ?? NaN);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new RegimeNotConfigured(regimeName, 'el número fiscal del documento');
    }
    return sequence;
  }

}
