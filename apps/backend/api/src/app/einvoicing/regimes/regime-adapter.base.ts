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
      throw new BadRequestError('EINVOICING.EMISOR_NO_ENCONTRADO');
    }
    return organization;
  }

  protected async customerOf(context: FiscalRegimeContext): Promise<Customer> {
    const customer = await context.manager.findOne(Customer, {
      where: { id: context.invoice.customerId, organizationId: context.organizationId },
    });
    if (!customer) {
      throw new BadRequestError('EINVOICING.RECEPTOR_NO_ENCONTRADO');
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
   * The consecutive out of the fiscal number the document already carries.
   *
   * The number the authority granted and the string written on the document are not the same
   * thing. The numbering adapters compose them per market, and this is the inverse:
   *
   * - `F001-00000123` (Peru) → 123. The series is not part of the consecutive.
   * - `001-002-000000045` (Ecuador) → 45. Establishment and emission point are not either.
   * - `SETP990000001` (Colombia) → 990000001. The prefix carries no digits.
   * - `7` (Chile, Brazil) → 7.
   *
   * So: the last hyphen-separated segment, digits only. Taking *all* the digits instead reads
   * Peru's `F001-00000123` as 100 000 123 — a number outside every range the tenant holds, which
   * surfaces as "this range does not contain that number" and sends whoever debugs it looking at
   * the range rather than at the parse.
   */
  protected assignedNumber(context: FiscalRegimeContext, regimeName: string): number {
    const raw = context.invoice.ncfNumber ?? '';
    const consecutive = raw.split('-').pop() ?? '';
    const digits = consecutive.replace(/\D/g, '');
    const parsed = Number(digits);
    if (!digits || !Number.isFinite(parsed) || parsed <= 0) {
      throw new RegimeNotConfigured(regimeName, 'el número fiscal del documento');
    }
    return parsed;
  }
}
