import { readFileSync } from 'fs';
import { join } from 'path';
import * as forge from 'node-forge';
import {
  assertStoredCertificateUsable,
  assessCertificate,
  inspectCertificate,
  sameIdentifier,
} from './certificate-inspector';
import { certificatePolicyFor } from '../contracts/certificate-policy';
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
const DO = certificatePolicyFor('DO')!;
const MX = certificatePolicyFor('MX')!;
const CO = certificatePolicyFor('CO')!;
const colmado = { country: 'DO', taxId: '130-45678-1' };

describe('certificate inspector', () => {
  it('reads the identifier a certificate carries and that it is self-signed', () => {
    const facts = inspectCertificate(load('test-ecf-do-130456781.p12'));
    expect(facts.holderIds).toContain('130456781');
    expect(facts.selfSigned).toBe(true);
    expect(facts.canSign).toBe(true);
    expect(facts.subjectCommonName).toBe('Colmado La Esquina SRL');
  });

  it("accepts the company's own certificate", () => {
    const facts = inspectCertificate(load('test-ecf-do-130456781.p12'));
    expect(assessCertificate(facts, colmado, DO, ALLOW_TEST)).toEqual({
      holderTaxId: '130456781',
      holderKind: 'company',
      test: true,
    });
  });

  // QA V01: «Ferreteria Demo SRL» was accepted for «Colmado La Esquina SRL».
  it('refuses a certificate that names no identifier', () => {
    const facts = inspectCertificate(load('test-ecf-sin-identificador.p12', 'sonda-ecf'));
    expect(refusal(() => assessCertificate(facts, colmado, DO, ALLOW_TEST))).toBe(
      'einvoicing.certificate.holder_unidentified',
    );
  });

  it("refuses another company's certificate", () => {
    const facts = inspectCertificate(load('test-ecf-do-101010632.p12'));
    expect(refusal(() => assessCertificate(facts, colmado, DO, ALLOW_TEST))).toBe(
      'einvoicing.certificate.belongs_to_other_company',
    );
  });

  it("accepts a person's certificate as the representative's where the market signs that way", () => {
    const facts = inspectCertificate(load('test-ecf-do-persona-00112345673.p12'));
    expect(assessCertificate(facts, colmado, DO, ALLOW_TEST)).toEqual({
      holderTaxId: '00112345673',
      holderKind: 'person',
      test: true,
    });
  });

  it("refuses a person's certificate where the market requires the company's own", () => {
    const facts = inspectCertificate(load('test-ecf-do-persona-00112345673.p12'));
    const strict = { ...DO, representativeAllowed: false };
    expect(refusal(() => assessCertificate(facts, colmado, strict, ALLOW_TEST))).toBe(
      'einvoicing.certificate.person_not_allowed',
    );
  });

  it('refuses a self-signed certificate unless tests are allowed', () => {
    const facts = inspectCertificate(load('test-ecf-do-130456781.p12'));
    expect(refusal(() => assessCertificate(facts, colmado, DO, { allowTestCertificates: false }))).toBe(
      'einvoicing.certificate.self_signed',
    );
  });

  it('refuses an expired certificate, before anything else', () => {
    const facts = inspectCertificate(load('test-ecf-do-130456781.p12'));
    const later = new Date(Date.now() + 20 * 365 * 86_400_000);
    expect(refusal(() => assessCertificate(facts, colmado, DO, { ...ALLOW_TEST, now: later }))).toBe(
      'einvoicing.certificate.expired',
    );
  });

  it('refuses when the company has no identifier to compare with', () => {
    const facts = inspectCertificate(load('test-ecf-do-130456781.p12'));
    expect(refusal(() => assessCertificate(facts, { country: 'DO', taxId: null }, DO, ALLOW_TEST))).toBe(
      'einvoicing.certificate.organization_has_no_tax_id',
    );
  });

  describe('in other markets', () => {
    it("accepts a Mexican CSD issued to the company's RFC", () => {
      const facts = inspectCertificate(load('test-ecf-mx-eku9003173c9.p12'));
      expect(assessCertificate(facts, { country: 'MX', taxId: 'EKU9003173C9' }, MX, ALLOW_TEST)).toEqual({
        holderTaxId: 'EKU9003173C9',
        holderKind: 'company',
        test: true,
      });
    });

    it('refuses a Mexican CSD of another RFC', () => {
      const facts = inspectCertificate(load('test-ecf-mx-eku9003173c9.p12'));
      expect(
        refusal(() => assessCertificate(facts, { country: 'MX', taxId: 'IIA040805DZ4' }, MX, ALLOW_TEST)),
      ).toBe('einvoicing.certificate.belongs_to_other_company');
    });

    it('matches a Colombian NIT recorded with its check digit against a certificate without it', () => {
      const facts = inspectCertificate(load('test-ecf-co-900373913.p12'));
      expect(assessCertificate(facts, { country: 'CO', taxId: '900373913-4' }, CO, ALLOW_TEST)).toMatchObject({
        holderKind: 'company',
        test: true,
      });
    });

    it('refuses a Dominican certificate for a Colombian company', () => {
      const facts = inspectCertificate(load('test-ecf-do-130456781.p12'));
      expect(refusal(() => assessCertificate(facts, { country: 'CO', taxId: '900373913-4' }, CO, ALLOW_TEST))).toBe(
        'einvoicing.certificate.holder_unidentified',
      );
    });
  });
});

describe('sameIdentifier', () => {
  it('is equality, or one more trailing check character', () => {
    expect(sameIdentifier('130456781', '130456781')).toBe(true);
    expect(sameIdentifier('900373913', '9003739134')).toBe(true);
    expect(sameIdentifier('130456781', '130456782')).toBe(false);
    expect(sameIdentifier('1304', '13045')).toBe(false);
  });
});

describe('assertStoredCertificateUsable', () => {
  const stored = { holderKind: 'company', holderTaxId: '130456781', subjectCommonName: 'Colmado La Esquina SRL' };

  it('accepts a certificate still in force for the same company', () => {
    expect(() => assertStoredCertificateUsable(stored, colmado, DO, ALLOW_TEST)).not.toThrow();
  });

  it("refuses one whose company's identifier has since changed", () => {
    expect(
      refusal(() => assertStoredCertificateUsable(stored, { country: 'DO', taxId: '131190317' }, DO, ALLOW_TEST)),
    ).toBe('einvoicing.certificate.belongs_to_other_company');
  });

  it('refuses a test certificate carried into an environment that does not allow them', () => {
    expect(
      refusal(() =>
        assertStoredCertificateUsable({ ...stored, isTest: true }, colmado, DO, { allowTestCertificates: false }),
      ),
    ).toBe('einvoicing.certificate.self_signed');
  });
});
