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
import { SiiBuilder } from './sii.builder';

/**
 * Chile — Documento Tributario Electrónico, SII.
 *
 * ## Two signatures, two keys, and they are not interchangeable
 *
 * A Chilean DTE is signed twice:
 *
 * 1. The **timbre** (`TED`) is sealed with the RSA key inside the CAF — the folio authorisation
 *    the SII issued. That is what makes the folio verifiable offline from a printed document.
 * 2. The **document** is signed with the taxpayer's own certificate, referencing the `Documento`
 *    element by id rather than the envelope.
 *
 * Sealing the timbre with the taxpayer's certificate, or signing the envelope instead of the
 * `Documento`, both produce a document the SII rejects — and each with a message about a
 * signature, which is the least informative kind of rejection to diagnose. So the CAF's key is
 * read from the range the folio came from and never confused with the certificate.
 *
 * ## The peso has no minor unit
 *
 * The SII rejects a decimal point in an amount. `SiiBuilder` writes them as integers already; what
 * matters here is that the same rounding reaches the timbre, since `MNT` is inside the sealed `DD`
 * and a mismatch between the sealed total and the document's total invalidates the timbre.
 */
@Injectable()
export class SiiRegimeAdapter extends RegimeAdapterBase implements FiscalRegimeAdapter {
  readonly countryCode = 'CL';
  readonly regime = 'SII DTE';

  private readonly builder = new SiiBuilder();

  constructor(
    vault: CertificateVaultService,
    private readonly signatures: XmlSignatureService,
    private readonly transport: RegimeTransportService,
    private readonly ranges: FiscalRangeService,
  ) {
    super({ regime: 'SII' }, vault);
  }

  async build(context: FiscalRegimeContext): Promise<SealedFiscalDocument> {
    const organization = await this.organizationOf(context);
    const customer = await this.customerOf(context);
    const settings = await this.settingsOf(context.manager, context.organizationId, 'CL');

    if (!settings?.activityCode) {
      throw new RegimeNotConfigured(this.regime, 'el código de actividad económica (Acteco)');
    }
    if (!settings.originComuna || !settings.originCity) {
      throw new RegimeNotConfigured(this.regime, 'la comuna y la ciudad de origen');
    }

    const folio = this.assignedNumber(context, this.regime);
    const documentType = this.builder.documentType(context.invoice);
    const range = await this.ranges.rangeContaining(context.manager, {
      organizationId: context.organizationId,
      countryCode: 'CL',
      documentType,
      number: folio,
    });

    if (range.secretKind !== FiscalRangeSecretKind.CAF_XML || !range.encryptedSecret) {
      throw new RegimeNotConfigured(this.regime, 'el archivo CAF que autoriza este folio');
    }

    const cafXml = this.ranges.secretOfRange(range);
    const { xml } = this.builder.build({
      invoice: context.invoice,
      organization,
      customer,
      caf: {
        folio,
        rangeFrom: Number(range.startsAt),
        rangeTo: Number(range.endsAt),
        authorizedOn: authorizationDateOf(cafXml),
        privateKeyPem: privateKeyOf(cafXml, this.regime),
        rawCafXml: cafXml,
      },
      activityCode: settings.activityCode,
      origin: {
        comuna: settings.originComuna,
        city: settings.originCity,
        address: organization.address ?? '',
      },
    });

    // The timbre is sealed HERE, not in `seal`, and the reason is a security property rather than
    // convenience: the CAF's private key is in scope only inside this method, decrypted from the
    // range. Carrying it out to `seal` would mean a private key riding on an object that is passed
    // around, logged and serialised. It is also the right order — the taxpayer's signature covers
    // `Documento`, and the timbre lives inside it, so sealing the timbre afterwards would
    // invalidate the digest that signature just computed.
    const sealed = this.sealTimbre(xml, privateKeyOf(cafXml, this.regime));

    // The SII assigns nothing at build time: the folio is the document's identity, and it came
    // from the CAF.
    return {
      payload: sealed,
      contentType: 'application/xml',
      documentKey: `${documentType}-${folio}`,
    };
  }

  /**
   * The taxpayer's own signature, over `Documento` by id.
   *
   * The timbre was already sealed in `build` with the CAF's key — a different key, a different
   * algorithm, and a different verifier at the SII. This is the second of the two.
   */
  seal(document: SealedFiscalDocument, certificate: LoadedCertificate): SealedFiscalDocument {
    const documentId = /<Documento\s+ID="([^"]+)"/.exec(document.payload)?.[1];
    if (!documentId) {
      throw new RegimeNotConfigured(this.regime, 'el identificador del documento en el DTE');
    }

    return {
      ...document,
      payload: this.signatures.sign(document.payload, certificate, {
        appendTo: 'DTE',
        // By id, not the envelope: the SII recomputes the digest over `Documento` and a signature
        // over the whole DTE is a rejection naming a reference.
        referenceUri: `#${documentId}`,
      }),
    };
  }

  /**
   * The `FRMT` — the timbre's own seal, over the `DD`, with the CAF's key.
   *
   * SHA1withRSA, which is what the SII specifies. It is not a choice: the verifier the SII runs
   * uses SHA-1 for the timbre regardless of what the rest of the document is signed with, and a
   * SHA-256 seal here is rejected as an invalid timbre.
   *
   * The key is passed in rather than read back out of the document, and that is deliberate: the
   * CAF's private key must never appear in the transmitted XML. What the document carries is the
   * CAF's public half — the `<DA>` the SII authorised and its `<FRMA>` — and anything more would
   * publish the taxpayer's folio-signing key to every recipient of every invoice.
   */
  private sealTimbre(payload: string, cafPrivateKeyPem: string): string {
    const ddMatch = /<DD>[\s\S]*?<\/DD>/.exec(payload);
    if (!ddMatch) throw new RegimeNotConfigured(this.regime, 'el bloque DD del timbre');

    const signature = this.signatures.sealSha1(ddMatch[0], cafPrivateKeyPem);
    return payload.replace(
      /<FRMT algoritmo="SHA1withRSA"\s*\/?>(<\/FRMT>)?/,
      `<FRMT algoritmo="SHA1withRSA">${signature}</FRMT>`,
    );
  }

  async transmit(
    document: SealedFiscalDocument,
    _context: FiscalRegimeContext,
  ): Promise<FiscalTransmissionResult> {
    const result = await this.transport.send('CL', document.payload, {
      contentType: 'application/xml',
      trackingKeys: ['TRACKID', 'trackid', 'TrackId'],
    });

    // The SII receives an envío and answers with a track id; whether the DTE inside it was
    // accepted is a separate query, so a received envío is not an accepted document.
    return result.status === 'ACCEPTED' ? { ...result, status: 'PENDING' } : result;
  }

  async checkStatus(
    trackingId: string,
    _context: FiscalRegimeContext,
  ): Promise<FiscalTransmissionResult> {
    return this.transport.send('CL', `<getEstUp><TRACKID>${trackingId}</TRACKID></getEstUp>`, {
      contentType: 'application/xml',
      trackingKeys: ['ESTADO', 'estado'],
    });
  }

  loadCertificate(context: FiscalRegimeContext): Promise<LoadedCertificate> {
    return this.certificateFor(context, this.regime, 'su certificado digital del SII');
  }
}

/**
 * The RSA private key the SII put inside the CAF, as PEM.
 *
 * The CAF carries it as `<RSASK>` in PEM already, so this extracts rather than converts. Written
 * as a function rather than a method because it is a property of the CAF file format, not of the
 * adapter, and the timbre sealing needs it from a fragment rather than the whole file.
 */
function privateKeyOf(cafXml: string, regime: string): string {
  const key = /<RSASK>([\s\S]*?)<\/RSASK>/.exec(cafXml)?.[1]?.trim();
  if (!key) throw new RegimeNotConfigured(regime, 'la clave privada (RSASK) del archivo CAF');
  return key;
}

/** `<FA>` — the date the SII authorised the folio range, `YYYY-MM-DD`. */
function authorizationDateOf(cafXml: string): string {
  return /<FA>([^<]+)<\/FA>/.exec(cafXml)?.[1]?.trim() ?? '';
}
