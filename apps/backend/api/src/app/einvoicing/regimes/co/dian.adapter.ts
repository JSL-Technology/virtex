import { Injectable } from '@nestjs/common';
import { CertificateVaultService, LoadedCertificate } from '../../services/certificate-vault.service';
import { XmlSignatureService } from '../xml-signature.service';
import { RegimeTransportService } from '../regime-transport.service';
import { FiscalRangeService } from '../../services/fiscal-range.service';
import { FiscalRangeSecretKind } from '../../entities/fiscal-document-range.entity';
import {
  FiscalRegimeAdapter,
  FiscalRegimeContext,
  FiscalTransmissionResult,
  RegimeNotConfigured,
  SealedFiscalDocument,
} from '../fiscal-regime.types';
import { RegimeAdapterBase } from '../regime-adapter.base';
import { DianBuilder } from './dian.builder';

/**
 * Colombia — factura electrónica DIAN, UBL 2.1.
 *
 * ## The technical key is not configuration, it is part of the authorisation
 *
 * The CUFE is a SHA-384 over the invoice's own fields **and the taxpayer's ClaveTécnica**, which
 * the DIAN issues together with the invoicing resolution that grants the number range. So the key
 * is read from the range the document's number came from, not from a settings row: a taxpayer who
 * has been granted a second resolution holds two keys at once, and a document numbered under the
 * first resolution whose CUFE is computed with the second one's key fails validation with a
 * message about the CUFE and nothing else.
 *
 * That is also why it is stored encrypted on the range. Anyone holding it can compute a CUFE that
 * the DIAN will accept as the taxpayer's.
 */
@Injectable()
export class DianRegimeAdapter extends RegimeAdapterBase implements FiscalRegimeAdapter {
  readonly countryCode = 'CO';
  readonly regime = 'DIAN UBL 2.1';

  private readonly builder = new DianBuilder();

  constructor(
    vault: CertificateVaultService,
    private readonly signatures: XmlSignatureService,
    private readonly transport: RegimeTransportService,
    private readonly ranges: FiscalRangeService,
  ) {
    super({ regime: 'DIAN' }, vault);
  }

  async build(context: FiscalRegimeContext): Promise<SealedFiscalDocument> {
    const organization = await this.organizationOf(context);
    const customer = await this.customerOf(context);
    const settings = await this.settingsOf(context.manager, context.organizationId, 'CO');

    const documentType = this.builder.documentType(context.invoice);
    const range = await this.ranges.rangeContaining(context.manager, {
      organizationId: context.organizationId,
      countryCode: 'CO',
      documentType,
      number: this.assignedNumber(context, this.regime),
    });

    if (range.secretKind !== FiscalRangeSecretKind.DIAN_TECHNICAL_KEY || !range.encryptedSecret) {
      throw new RegimeNotConfigured(this.regime, 'la ClaveTécnica de la resolución de facturación');
    }

    const { xml, cufe } = this.builder.build({
      invoice: context.invoice,
      organization,
      customer,
      technicalKey: this.ranges.secretOfRange(range),
      // The DIAN's own coding: `1` producción, `2` pruebas. The CUFE differs between the two
      // deliberately, so a document built for one environment cannot be filed into the other.
      environment: this.environmentCode(settings, { production: '1', certification: '2' }) as
        | '1'
        | '2',
      resolution: {
        number: range.authorizationCode ?? settings?.resolutionNumber ?? '',
        prefix: range.series,
        from: String(range.startsAt),
        to: String(range.endsAt),
        validUntil: range.validUntil ?? '',
      },
    });

    return { payload: xml, contentType: 'application/xml', documentKey: cufe };
  }

  /**
   * XAdES over the whole invoice, appended inside the UBL extension the DIAN requires.
   *
   * The reference is the empty URI — the whole document — with the enveloped transform, which is
   * what the DIAN's validator recomputes. Signing the extension element instead is the mistake
   * that produces a rejection naming a digest.
   */
  seal(document: SealedFiscalDocument, certificate: LoadedCertificate): SealedFiscalDocument {
    return {
      ...document,
      payload: this.signatures.sign(document.payload, certificate, {
        appendTo: 'ExtensionContent',
        referenceUri: '',
      }),
    };
  }

  async transmit(
    document: SealedFiscalDocument,
    _context: FiscalRegimeContext,
  ): Promise<FiscalTransmissionResult> {
    const result = await this.transport.send('CO', document.payload, {
      contentType: 'application/xml',
      trackingKeys: ['ZipKey', 'TrackId', 'trackId'],
    });
    // The CUFE is ours, computed at build time, and stays the document's identity whatever the
    // DIAN answers: a rejected invoice still has one, and it is how the rejection is looked up.
    return { ...result, authorization: result.authorization ?? document.documentKey };
  }

  async checkStatus(
    trackingId: string,
    _context: FiscalRegimeContext,
  ): Promise<FiscalTransmissionResult> {
    return this.transport.send(
      'CO',
      `<GetStatusZip><trackId>${trackingId}</trackId></GetStatusZip>`,
      { contentType: 'application/xml', trackingKeys: ['TrackId', 'trackId'] },
    );
  }

  /** The tenant's DIAN signing certificate. */
  loadCertificate(context: FiscalRegimeContext): Promise<LoadedCertificate> {
    return this.certificateFor(context, this.regime, 'su certificado de firma digital');
  }
}
