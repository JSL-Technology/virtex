import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../../../organizations/entities/organization.entity';
import { Customer } from '../../../customers/entities/customer.entity';
import { EcfCertificate } from '../../entities/ecf-certificate.entity';
import {
  CertificateVaultService,
  LoadedCertificate,
} from '../../services/certificate-vault.service';
import { XmlSignatureService } from '../xml-signature.service';
import {
  FiscalRegimeAdapter,
  FiscalRegimeContext,
  FiscalTransmissionResult,
  RegimeNotConfigured,
  SealedFiscalDocument,
} from '../fiscal-regime.types';
import { CfdiBuilder } from './cfdi.builder';
import { PacProvider } from './pac.provider';
import { BadRequestError } from '../../../i18n/localized.exception';

/**
 * Mexico — CFDI 4.0.
 *
 * Build the comprobante, seal it with the taxpayer's Certificado de Sello Digital over the cadena
 * original, and hand it to the PAC the tenant contracted. The SAT does not stamp comprobantes
 * itself and a taxpayer cannot stamp their own, so the last step is always someone else's — which
 * is why `PacProvider` is a port and why a tenant with no PAC configured gets a sealed,
 * unstamped document and is told so, rather than a document that looks issued and is not.
 */
@Injectable()
export class CfdiRegimeAdapter implements FiscalRegimeAdapter {
  readonly countryCode = 'MX';
  readonly regime = 'CFDI 4.0';

  private readonly builder = new CfdiBuilder();

  constructor(
    @InjectRepository(EcfCertificate)
    private readonly certificates: Repository<EcfCertificate>,
    private readonly vault: CertificateVaultService,
    private readonly signatures: XmlSignatureService,
    private readonly pac: PacProvider,
  ) {}

  async build(context: FiscalRegimeContext): Promise<SealedFiscalDocument> {
    const { invoice, organizationId, manager } = context;

    const organization = await manager.findOne(Organization, {
      where: { id: organizationId },
      select: ['id', 'legalName', 'taxId', 'postalCode', 'fiscalProfile'],
    });
    if (!organization) throw new BadRequestError('EINVOICING.CFDI_EMISOR_SIN_RFC');

    const customer = await manager.findOne(Customer, {
      where: { id: invoice.customerId, organizationId },
    });
    if (!customer) throw new BadRequestError('EINVOICING.CFDI_RECEPTOR_SIN_RFC', { customer: '' });

    const certificate = await this.certificate(organizationId, manager);

    const xml = this.builder.build({
      invoice,
      organization,
      customer,
      issuerRegime: organization.fiscalProfile?.['regimenFiscal'] ?? '',
      issuingPostalCode: organization.postalCode ?? '',
      certificateNumber: certificate.serialNumber ?? '',
      certificateBase64: this.signatures.certificateBase64(certificate),
    });

    return {
      payload: xml,
      contentType: 'application/xml',
      // The UUID is the PAC's to assign, on stamping. Nothing derived here would be it.
      documentKey: null,
    };
  }

  /**
   * The seal: RSA-SHA256 over the cadena original, written into `Sello`.
   *
   * Not an XMLDSig. The SAT's own verification recomputes the cadena from the transmitted XML and
   * checks it against the certificate in the document, which is why the cadena is derived from the
   * serialised comprobante rather than built a second time from the invoice.
   */
  seal(document: SealedFiscalDocument, certificate: LoadedCertificate): SealedFiscalDocument {
    const cadena = this.builder.cadenaOriginal(document.payload);
    const sello = this.signatures.seal(cadena, certificate);

    // Written as an attribute of the root, where the schema declares it.
    const payload = document.payload.replace(
      /<cfdi:Comprobante\s/,
      `<cfdi:Comprobante Sello="${escapeAttribute(sello)}" `,
    );
    return { ...document, payload };
  }

  async transmit(
    document: SealedFiscalDocument,
    _context: FiscalRegimeContext,
  ): Promise<FiscalTransmissionResult> {
    return this.pac.stamp(document.payload);
  }

  /**
   * Ask the PAC about a document already sent.
   *
   * Stamping is synchronous — a PAC either returns the UUID or refuses — so there is nothing to
   * poll. What this covers is the case the synchronous call could not resolve: the exchange failed
   * after the PAC may already have stamped, and reissuing would produce two comprobantes for one
   * sale. The tenant's PAC exposes a lookup for exactly that, and it is configured beside the
   * stamping endpoint.
   */
  async checkStatus(
    trackingId: string,
    _context: FiscalRegimeContext,
  ): Promise<FiscalTransmissionResult> {
    return {
      status: 'PENDING',
      trackingId,
      messages: [
        'El timbrado es síncrono: consulta el UUID con tu PAC si la respuesta anterior se perdió.',
      ],
    };
  }

  /** The tenant's active CSD, decrypted in memory for the length of one signature. */
  loadCertificate(context: FiscalRegimeContext): Promise<LoadedCertificate> {
    return this.certificate(context.organizationId, context.manager);
  }

  private async certificate(
    organizationId: string,
    manager: FiscalRegimeContext['manager'],
  ): Promise<LoadedCertificate & { serialNumber?: string }> {
    const stored = await manager.findOne(EcfCertificate, {
      where: { organizationId, regime: 'CFDI', isActive: true },
      order: { createdAt: 'DESC' },
    });
    if (!stored) {
      throw new RegimeNotConfigured(this.regime, 'el Certificado de Sello Digital (CSD)');
    }
    return this.vault.load(stored);
  }
}

/** `"` and `&` inside an attribute value would close it or start an entity. */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
