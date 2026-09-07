import { Injectable } from '@nestjs/common';
import { CertificateVaultService, LoadedCertificate } from '../../services/certificate-vault.service';
import { XmlSignatureService } from '../xml-signature.service';
import { RegimeTransportService } from '../regime-transport.service';
import {
  FiscalRegimeAdapter,
  FiscalRegimeContext,
  FiscalTransmissionResult,
  RegimeNotConfigured,
  SealedFiscalDocument,
} from '../fiscal-regime.types';
import { RegimeAdapterBase } from '../regime-adapter.base';
import { SriBuilder } from './sri.builder';

/**
 * Ecuador — comprobante electrónico, SRI.
 *
 * ## Reception and authorisation are two calls, not one
 *
 * The SRI takes a document (`recepcion`) and answers only that it was received or refused for a
 * structural reason. Whether it is *authorised* — which is what gives it fiscal effect — comes
 * from a second call (`autorizacion`) keyed by the clave de acceso, and it can take minutes. A
 * document that was received and never authorised has no fiscal effect at all, so treating
 * reception as success would tell the taxpayer they had issued something they had not.
 *
 * Hence `transmit` returns `PENDING` on a clean reception, and `checkStatus` is what turns it into
 * `ACCEPTED`. The scheduler that already reconciles Dominican e-CFs does the same job here.
 *
 * ## The environment is coded backwards from Colombia's
 *
 * `1` is **pruebas** and `2` is **producción** — the opposite of the DIAN. It is part of the
 * 49-digit clave de acceso, so a document built with the wrong digit has a different key, and the
 * SRI rejects it with a message about the key rather than about the environment.
 */
@Injectable()
export class SriRegimeAdapter extends RegimeAdapterBase implements FiscalRegimeAdapter {
  readonly countryCode = 'EC';
  readonly regime = 'SRI 2.1.0';

  private readonly builder = new SriBuilder();

  constructor(
    vault: CertificateVaultService,
    private readonly signatures: XmlSignatureService,
    private readonly transport: RegimeTransportService,
  ) {
    super({ regime: 'SRI' }, vault);
  }

  async build(context: FiscalRegimeContext): Promise<SealedFiscalDocument> {
    const organization = await this.organizationOf(context);
    const customer = await this.customerOf(context);
    const settings = await this.settingsOf(context.manager, context.organizationId, 'EC');

    if (!settings?.establishment || !settings?.emissionPoint) {
      throw new RegimeNotConfigured(this.regime, 'el establecimiento y el punto de emisión del SRI');
    }
    if (!settings.numericCode) {
      throw new RegimeNotConfigured(this.regime, 'el código numérico de ocho dígitos');
    }

    const { xml, accessKey } = this.builder.build({
      invoice: context.invoice,
      organization,
      customer,
      // Not a typo and not shared with Colombia: the SRI numbers them the other way round.
      environment: this.environmentCode(settings, { production: '2', certification: '1' }) as
        | '1'
        | '2',
      establishment: settings.establishment,
      emissionPoint: settings.emissionPoint,
      numericCode: settings.numericCode,
    });

    return { payload: xml, contentType: 'application/xml', documentKey: accessKey };
  }

  /** XAdES-BES enveloped in the comprobante root, which is what the SRI's validator expects. */
  seal(document: SealedFiscalDocument, certificate: LoadedCertificate): SealedFiscalDocument {
    return {
      ...document,
      payload: this.signatures.sign(document.payload, certificate, {
        appendTo: 'factura',
        referenceUri: '',
      }),
    };
  }

  async transmit(
    document: SealedFiscalDocument,
    _context: FiscalRegimeContext,
  ): Promise<FiscalTransmissionResult> {
    const received = await this.transport.send('EC', document.payload, {
      contentType: 'application/xml',
      trackingKeys: ['claveAcceso', 'estado'],
    });

    if (received.status === 'REJECTED' || received.status === 'NOT_CONFIGURED') return received;

    // Received is not authorised. The clave de acceso is what the authorisation is asked for by,
    // and it is ours — computed at build time — so it is the tracking handle whatever came back.
    return {
      ...received,
      status: 'PENDING',
      trackingId: document.documentKey,
      messages: [
        ...received.messages,
        'Recibido por el SRI. La autorización se consulta por separado y es la que da efecto fiscal.',
      ],
    };
  }

  /** The second call: authorised, or refused with the SRI's own reasons. */
  async checkStatus(
    trackingId: string,
    _context: FiscalRegimeContext,
  ): Promise<FiscalTransmissionResult> {
    const result = await this.transport.send(
      'EC',
      `<autorizacionComprobante><claveAccesoComprobante>${trackingId}` +
        `</claveAccesoComprobante></autorizacionComprobante>`,
      { contentType: 'application/xml', trackingKeys: ['numeroAutorizacion'] },
    );

    return { ...result, authorization: result.trackingId ?? null, trackingId };
  }

  loadCertificate(context: FiscalRegimeContext): Promise<LoadedCertificate> {
    return this.certificateFor(context, this.regime, 'su certificado de firma electrónica');
  }
}
