import { readFileSync } from 'fs';
import { join } from 'path';
import * as forge from 'node-forge';
import { assessCertificate, inspectCertificate } from './certificate-inspector';
import { BadRequestError } from '../../i18n/localized.exception';

/**
 * Against the real PKCS#12 files a developer uploads (tools/fixtures/ecf-certificates), not
 * hand-built objects: the extraction has to work on what a certification authority writes.
 */
const FIXTURES = join(__dirname, '../../../../../../../tools/fixtures/ecf-certificates');

function load(file: string, password = 'virtex-pruebas'): forge.pki.Certificate {
  const der = readFileSync(join(FIXTURES, file)).toString('binary');
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), password);
  const bag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0];
  if (!bag?.cert) throw new Error(`no certificate in ${file}`);
  return bag.cert;
}

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof BadRequestError) return error.messageKey;
    throw error;
  }
  throw new Error('expected a refusal');
}

const ALLOW_TEST = { allowTestCertificates: true };

describe('certificate inspector', () => {
  it('reads the RNC a certificate carries and that it is self-signed', () => {
    const facts = inspectCertificate(load('test-ecf-130456781.p12'));
    expect(facts.holderIds).toEqual(['130456781']);
    expect(facts.selfSigned).toBe(true);
    expect(facts.canSign).toBe(true);
    expect(facts.subjectCommonName).toBe('Colmado La Esquina SRL');
  });

  it("accepts the company's own certificate", () => {
    const facts = inspectCertificate(load('test-ecf-130456781.p12'));
    expect(assessCertificate(facts, '130-45678-1', ALLOW_TEST)).toEqual({
      holderTaxId: '130456781',
      holderKind: 'company',
      test: true,
    });
  });

  // QA V01: «Ferreteria Demo SRL» was accepted for «Colmado La Esquina SRL».
  it('refuses a certificate that names no RNC or cédula', () => {
    const facts = inspectCertificate(load('test-ecf-sin-identificador.p12', 'sonda-ecf'));
    expect(facts.holderIds).toEqual([]);
    expect(refusal(() => assessCertificate(facts, '130456781', ALLOW_TEST))).toContain(
      'certificate_holder_unidentified',
    );
  });

  it("refuses another company's certificate", () => {
    const facts = inspectCertificate(load('test-ecf-131190317.p12'));
    expect(refusal(() => assessCertificate(facts, '130456781', ALLOW_TEST))).toContain(
      'certificate_belongs_to_other_rnc',
    );
  });

  it("accepts a certificate issued to a person's cédula, as the representative's", () => {
    const facts = inspectCertificate(load('test-ecf-cedula-00112345673.p12'));
    expect(assessCertificate(facts, '130456781', ALLOW_TEST)).toEqual({
      holderTaxId: '00112345673',
      holderKind: 'person',
      test: true,
    });
  });

  it('refuses a self-signed certificate unless tests are allowed', () => {
    const facts = inspectCertificate(load('test-ecf-130456781.p12'));
    expect(refusal(() => assessCertificate(facts, '130456781', { allowTestCertificates: false }))).toContain(
      'certificate_self_signed',
    );
  });

  it('refuses an expired certificate, before anything else', () => {
    const facts = inspectCertificate(load('test-ecf-130456781.p12'));
    const later = new Date(Date.now() + 5 * 365 * 86_400_000);
    expect(refusal(() => assessCertificate(facts, '130456781', { ...ALLOW_TEST, now: later }))).toContain(
      'certificate_expired',
    );
  });
});
