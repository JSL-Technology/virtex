import * as crypto from 'crypto';
import { SignedXml } from 'xml-crypto';
import { XmlSignatureService } from './xml-signature.service';
import type { LoadedCertificate } from '../services/certificate-vault.service';

/**
 * The signature every regime's document rests on, verified cryptographically.
 *
 * A signature test that asserts a `<Signature>` element exists proves nothing: an authority
 * recomputes the digest over exactly what the reference names and checks it against the signer's
 * public key, and a signature over the wrong element passes any structural assertion and fails
 * every upload. So these generate a real key pair, sign, and then **verify** — the same operation
 * the authority performs.
 */
describe('XML signature profiles', () => {
  const service = new XmlSignatureService();
  let certificate: LoadedCertificate;

  beforeAll(() => {
    // A real RSA key and a real self-signed X.509, generated here. Not a fixture on disk: a
    // committed private key is a committed private key, whatever it was generated for.
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    certificate = {
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      certificatePem: selfSignedCertificate(publicKey, privateKey),
    };
  });

  /** Verify a signature the way the authority does: recompute and compare against the public key. */
  const verifies = (signedXml: string): boolean => {
    const verifier = new SignedXml();
    const signature = signedXml.match(/<(?:\w+:)?Signature[\s\S]*<\/(?:\w+:)?Signature>/)?.[0];
    if (!signature) return false;
    verifier.publicCert = certificate.certificatePem;
    verifier.loadSignature(signature);
    return verifier.checkSignature(signedXml);
  };

  it('signs a whole document and produces a signature that verifies', () => {
    const xml = '<Comprobante><Total>1180.00</Total></Comprobante>';

    const signed = service.sign(xml, certificate, { appendTo: 'Comprobante' });

    expect(signed).toContain('Signature');
    expect(signed).toContain('rsa-sha256');
    expect(verifies(signed)).toBe(true);
  });

  it('signs one element by id, which is what Brazil and Chile require', () => {
    // The authority recomputes the digest over what the reference names and over nothing else.
    // Signing the envelope when the schema says to sign the inner element is the single most
    // common cause of a rejected e-invoice, and it passes every structural assertion.
    const xml =
      '<NFe><infNFe Id="NFe4310"><ide><nNF>1</nNF></ide></infNFe></NFe>';

    const signed = service.sign(xml, certificate, {
      appendTo: 'NFe',
      referenceUri: '#NFe4310',
    });

    expect(signed).toContain('URI="#NFe4310"');
    expect(verifies(signed)).toBe(true);
  });

  it('detects a document altered after signing', () => {
    const xml = '<Comprobante><Total>1180.00</Total></Comprobante>';
    const signed = service.sign(xml, certificate, { appendTo: 'Comprobante' });

    // The whole point: an invoice whose total was edited after sealing must not verify.
    const tampered = signed.replace('1180.00', '1.00');

    expect(verifies(tampered)).toBe(false);
  });

  it('seals a cadena original the way Mexico and Chile do', () => {
    // Mexico does not use XMLDSig for the CFDI at all: it seals a pipe-delimited projection of
    // the document and writes the base64 result into a `Sello` attribute.
    const cadena = '||4.0|A|1|2026-06-10T12:00:00|AAA010101AAA|1180.00||';

    const sello = service.seal(cadena, certificate);

    expect(sello).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(cadena, 'utf8');
    verifier.end();
    expect(verifier.verify(certificate.certificatePem, Buffer.from(sello, 'base64'))).toBe(true);
  });

  it('strips the PEM armour from the certificate the document has to carry', () => {
    const base64 = service.certificateBase64(certificate);

    expect(base64).not.toContain('BEGIN CERTIFICATE');
    expect(base64).not.toMatch(/\s/);
    // Round-trips: what the authority parses out of the document is the certificate we signed with.
    expect(
      new crypto.X509Certificate(Buffer.from(base64, 'base64')).publicKey.export({
        type: 'spki',
        format: 'pem',
      }),
    ).toBe(
      new crypto.X509Certificate(certificate.certificatePem).publicKey.export({
        type: 'spki',
        format: 'pem',
      }),
    );
  });
});

/**
 * A self-signed X.509 over the given key pair.
 *
 * Built with node's own ASN.1 through `crypto`, so the suite carries no committed key material and
 * no fixture that could drift from what the code expects.
 */
function selfSignedCertificate(
  publicKey: crypto.KeyObject,
  privateKey: crypto.KeyObject,
): string {
  // `node-forge` is already a dependency and builds certificates directly; using it here keeps the
  // test honest — this is a real certificate, parsed by the same library the vault parses with.
  const forge = require('node-forge') as typeof import('node-forge');
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(
    publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  );
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2030-01-01T00:00:00Z');
  const attrs = [{ name: 'commonName', value: 'VIRTEX PRUEBAS' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(
    forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()),
    forge.md.sha256.create(),
  );
  return forge.pki.certificateToPem(cert);
}
