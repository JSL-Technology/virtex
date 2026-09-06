import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { SignedXml } from 'xml-crypto';
import type { LoadedCertificate } from '../services/certificate-vault.service';
import { InternalServerError } from '../../i18n/localized.exception';

/**
 * The XML signature profiles the Latin American e-invoicing regimes use.
 *
 * ## Why one service and not one per country
 *
 * Six of the seven regimes sign XML, and all six sign it with RSA-SHA256 over a SHA-256 digest,
 * canonicalised the same way. What differs is small and enumerable: which element the reference
 * points at, whether the signature is enveloped in the document root or in a child, and whether an
 * XAdES qualifying-properties block accompanies it. Writing six signers to vary those three things
 * is six places for the algorithm suite to drift apart, and a signature that drifts is a document
 * the authority rejects with a message about a hash.
 *
 * `EcfSignerService` stays as it is: the DGII profile is already correct, already in production,
 * and rewriting a working signature to share code with six that are not yet proven would risk the
 * one market that works today for the convenience of the six that do not.
 *
 * ## The profiles
 *
 * - **Enveloped, whole document** (`uri: ''`) — the plain XMLDSig every regime falls back to.
 * - **Enveloped, element by id** (`uri: '#id'`) — Brazil signs `infNFe`, not the envelope, and the
 *   reference must name it; Chile signs the `Documento` inside the DTE.
 * - **XAdES-BES / EPES** — Colombia, Peru and Ecuador require the qualifying properties that bind
 *   the signature to the signer's certificate and, for EPES, to the policy the authority
 *   publishes. Those go in a `<ds:Object>` inside the signature.
 *
 * *Verificar con contabilidad/legal*: each authority publishes its own signature policy identifier
 * and its OID, and they change between versions of a regime's technical annex. The policy hash and
 * URL are configuration per tenant, not constants here, for exactly that reason.
 */
@Injectable()
export class XmlSignatureService {
  private static readonly RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  private static readonly SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
  private static readonly C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
  private static readonly ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

  /**
   * Sign a document, appending `<Signature>` inside the element named by `appendTo`.
   *
   * @param referenceUri `''` for the whole document, or `#someId` to sign one element. Getting
   *   this wrong is the single most common cause of a rejected e-invoice: the authority
   *   recomputes the digest over what the reference names, and over nothing else.
   */
  sign(
    xml: string,
    certificate: LoadedCertificate,
    options: {
      appendTo: string;
      referenceUri?: string;
      /** Where the reference's digest is computed from, when it is not the whole document. */
      referenceXpath?: string;
    },
  ): string {
    const referenceUri = options.referenceUri ?? '';
    const isWholeDocument = referenceUri === '';

    const signer = new SignedXml({
      privateKey: certificate.privateKeyPem,
      publicCert: certificate.certificatePem,
      signatureAlgorithm: XmlSignatureService.RSA_SHA256,
      canonicalizationAlgorithm: XmlSignatureService.C14N,
    });

    signer.addReference({
      xpath:
        options.referenceXpath ??
        (isWholeDocument
          ? `//*[local-name(.)='${options.appendTo}']`
          : `//*[@Id='${referenceUri.replace(/^#/, '')}']`),
      transforms: [XmlSignatureService.ENVELOPED, XmlSignatureService.C14N],
      digestAlgorithm: XmlSignatureService.SHA256,
      uri: referenceUri,
      isEmptyUri: isWholeDocument,
    });

    try {
      signer.computeSignature(xml, {
        location: { reference: `//*[local-name(.)='${options.appendTo}']`, action: 'append' },
      });
    } catch (error) {
      throw new InternalServerError('EINVOICING.NO_SE_PUDO_FIRMAR_DOCUMENTO', {
        detail: (error as Error).message,
      });
    }

    return signer.getSignedXml();
  }

  /**
   * An RSA-SHA256 seal over an arbitrary string, base64.
   *
   * Mexico does not sign the CFDI with XMLDSig at all: it seals a *cadena original* — a
   * pipe-delimited projection of the document produced by an XSLT the SAT publishes — and writes
   * the base64 result into a `Sello` attribute. Chile seals its own `TED` the same way.
   */
  seal(plaintext: string, certificate: LoadedCertificate): string {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(plaintext, 'utf8');
    signer.end();
    return signer.sign(certificate.privateKeyPem).toString('base64');
  }

  /** The certificate's DER bytes, base64, with the PEM armour removed. */
  certificateBase64(certificate: LoadedCertificate): string {
    return certificate.certificatePem
      .replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
      .replace(/\s+/g, '');
  }

  /** SHA-256 of a string, hex — the shape most of these regimes' document keys are built from. */
  sha256Hex(value: string): string {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
