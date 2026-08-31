import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SignedXml } from 'xml-crypto';
import type { LoadedCertificate } from './certificate-vault.service';

/**
 * Applies the enveloped XMLDSig signature the DGII mandates for e-CF and for the authentication
 * seed (semilla). The algorithm suite is fixed by the DGII spec:
 *   - SignatureMethod   RSA-SHA256
 *   - DigestMethod      SHA-256
 *   - Canonicalization  Inclusive C14N (REC-xml-c14n-20010315)
 *   - Transform         enveloped-signature
 *   - Reference         URI="" (the whole document)
 *   - KeyInfo           X509Data / X509Certificate
 *
 * This replaces the previous stub whose `signXml` set a fake `signingKey` and never produced a
 * verifiable signature.
 */
@Injectable()
export class EcfSignerService {
  private static readonly SIGNATURE_ALGO = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  private static readonly DIGEST_ALGO = 'http://www.w3.org/2001/04/xmlenc#sha256';
  private static readonly C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
  private static readonly ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

  /**
   * Signs `xml`, appending the `<Signature>` as the last child of the element whose local name is
   * `rootLocalName` (`ECF` for a comprobante, `SemillaModel` for the auth seed).
   */
  sign(xml: string, cert: LoadedCertificate, rootLocalName: string): string {
    const rootXpath = `//*[local-name(.)='${rootLocalName}']`;
    const sig = new SignedXml({
      privateKey: cert.privateKeyPem,
      publicCert: cert.certificatePem,
      signatureAlgorithm: EcfSignerService.SIGNATURE_ALGO,
      canonicalizationAlgorithm: EcfSignerService.C14N,
    });

    sig.addReference({
      xpath: rootXpath,
      transforms: [EcfSignerService.ENVELOPED, EcfSignerService.C14N],
      digestAlgorithm: EcfSignerService.DIGEST_ALGO,
      uri: '',
      isEmptyUri: true,
    });

    try {
      sig.computeSignature(xml, { location: { reference: rootXpath, action: 'append' } });
    } catch (err) {
      throw new InternalServerErrorException(
        `No se pudo firmar el documento e-CF: ${(err as Error).message}`,
      );
    }

    return sig.getSignedXml();
  }

  /**
   * Código de seguridad: the DGII defines it as the first 6 characters of the document's
   * SignatureValue. It is embedded in the QR of the representación impresa.
   */
  securityCode(signedXml: string): string {
    const value = this.extractSignatureValue(signedXml);
    return value.replace(/\s+/g, '').substring(0, 6);
  }

  private extractSignatureValue(signedXml: string): string {
    const match = signedXml.match(/<(?:[\w-]+:)?SignatureValue[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?SignatureValue>/);
    if (!match) {
      throw new InternalServerErrorException('El documento firmado no contiene un SignatureValue.');
    }
    return match[1];
  }
}
