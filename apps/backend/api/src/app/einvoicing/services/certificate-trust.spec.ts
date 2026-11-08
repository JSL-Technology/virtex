import * as forge from 'node-forge';
import { loadTrustAnchors, parsePemBundle, verifyCertificateChain } from './certificate-trust';

/**
 * EINV-03 (audit 2026-10-31): a leaf from a home-made CA ("QA-F5 Fake CA") carrying the company's
 * RNC was accepted and unlocked issuance. Only self-signed files were refused.
 */
describe('certificate chain trust', () => {
  const keys = () => forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  function issue(
    subjectCn: string,
    subjectKeys: forge.pki.rsa.KeyPair,
    issuer: { cert: forge.pki.Certificate | null; keys: forge.pki.rsa.KeyPair },
    ca: boolean,
    days = 365,
  ): forge.pki.Certificate {
    const cert = forge.pki.createCertificate();
    cert.publicKey = subjectKeys.publicKey;
    cert.serialNumber = String(Math.floor(Math.random() * 1e9));
    cert.validity.notBefore = new Date(Date.now() - 86_400_000);
    cert.validity.notAfter = new Date(Date.now() + days * 86_400_000);
    cert.setSubject([{ name: 'commonName', value: subjectCn }]);
    cert.setIssuer(issuer.cert ? issuer.cert.subject.attributes : [{ name: 'commonName', value: subjectCn }]);
    cert.setExtensions([{ name: 'basicConstraints', cA: ca }]);
    cert.sign(issuer.keys.privateKey, forge.md.sha256.create());
    return cert;
  }

  const rootKeys = keys();
  const root = issue('QA Root CA autorizada', rootKeys, { cert: null, keys: rootKeys }, true);
  const intermediateKeys = keys();
  const intermediate = issue('QA Intermedia', intermediateKeys, { cert: root, keys: rootKeys }, true);
  const leafKeys = keys();
  const leaf = issue('QA EMPRESA SRL', leafKeys, { cert: intermediate, keys: intermediateKeys }, false);
  const fakeKeys = keys();
  const fakeRoot = issue('QA-F5 Fake CA', fakeKeys, { cert: null, keys: fakeKeys }, true);
  const forged = issue('QA EMPRESA SRL', keys(), { cert: fakeRoot, keys: fakeKeys }, false);

  it('trusts a leaf that chains, through the intermediate its file carries, to a configured root', () => {
    expect(verifyCertificateChain(leaf, [intermediate], [root])).toEqual({ trusted: true, anchor: 'QA Root CA autorizada' });
  });

  it('refuses a leaf from any other authority, whatever name it carries', () => {
    expect(verifyCertificateChain(forged, [fakeRoot], [root])).toEqual({ trusted: false, reason: 'untrusted_chain' });
  });

  it('refuses a leaf whose file lacks the intermediate the configured roots need', () => {
    expect(verifyCertificateChain(leaf, [], [root]).trusted).toBe(false);
  });

  it('says when nothing is configured to trust', () => {
    expect(verifyCertificateChain(leaf, [intermediate], [])).toEqual({ trusted: false, reason: 'no_trust_store' });
  });

  it('refuses a chain that is not in force on the date', () => {
    const later = new Date(Date.now() + 400 * 86_400_000);
    expect(verifyCertificateChain(leaf, [intermediate], [root], later).trusted).toBe(false);
  });

  it('reads the anchors of a market from its PEM bundle', () => {
    const bundle = [root, intermediate].map((c) => forge.pki.certificateToPem(c)).join('\n');
    expect(parsePemBundle(bundle)).toHaveLength(2);
    const anchors = loadTrustAnchors('do', (key) => (key === 'ECF_TRUSTED_CA_BUNDLE_DO' ? '/bundle.pem' : undefined), () => bundle);
    expect(anchors).toHaveLength(2);
    expect(loadTrustAnchors('MX', () => undefined)).toEqual([]);
  });
});
