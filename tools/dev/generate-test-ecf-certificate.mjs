#!/usr/bin/env node
/**
 * Generates a SELF-SIGNED PKCS#12 to exercise electronic invoicing in development, in any market.
 *
 *   node tools/dev/generate-test-ecf-certificate.mjs --country DO --tax-id 130456781 --name "Colmado La Esquina SRL"
 *   node tools/dev/generate-test-ecf-certificate.mjs --country MX --tax-id EKU9003173C9 --name "Escuela Kemper Urgate"
 *   node tools/dev/generate-test-ecf-certificate.mjs --country DO --tax-id 00112345673 --name "Laura Martínez" --person
 *
 * What it is for: uploading a certificate in the company's electronic-invoicing settings and
 * issuing electronic documents end to end on a local machine — numbering, signature, ledger, PDF,
 * e-mail — whatever the country.
 *
 * What it is NOT: a certificate any tax authority accepts. Only an authority-approved certification
 * provider issues one, to the taxpayer's identifier (or, where the market allows it, to a person the
 * taxpayer authorised). The API refuses a self-signed certificate unless the process is a
 * development or test environment AND `ECF_ALLOW_TEST_CERTIFICATES=true`.
 *
 * The holder's identifier is written where certification authorities write it: the subject's
 * `serialNumber` (2.5.4.5) and, for a company, `organizationIdentifier` (2.5.4.97) in the ETSI
 * `VAT<CC>-<id>` form. That is what lets the upload check that the certificate is the company's.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import forge from 'node-forge';

const { values } = parseArgs({
  options: {
    country: { type: 'string' },
    'tax-id': { type: 'string' },
    name: { type: 'string' },
    person: { type: 'boolean', default: false },
    password: { type: 'string', default: 'virtex-pruebas' },
    days: { type: 'string', default: '365' },
    out: { type: 'string' },
  },
});

const country = (values.country ?? '').toUpperCase();
const taxId = (values['tax-id'] ?? '').toUpperCase().replace(/[^A-Z0-9&Ñ]/g, '');
if (!/^[A-Z]{2}$/.test(country) || !taxId) {
  console.error('Pass --country <ISO code> and --tax-id <the holder\'s identifier>.');
  process.exit(1);
}
const person = values.person;
const name = values.name ?? (person ? `Persona de pruebas ${taxId}` : `Empresa de pruebas ${taxId}`);
const out = values.out ?? `test-ecf-${country.toLowerCase()}-${taxId.toLowerCase()}.p12`;

const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(15));
cert.validity.notBefore = new Date(Date.now() - 60_000);
cert.validity.notAfter = new Date(Date.now() + Number(values.days) * 86_400_000);

const subject = [
  { name: 'commonName', value: name },
  { shortName: 'C', value: country },
  { shortName: 'OU', value: 'PRUEBAS - NO VALIDO ANTE LA AUTORIDAD FISCAL' },
  { type: '2.5.4.5', value: person ? `IDC${country}-${taxId}` : taxId },
];
if (!person) {
  subject.push({ name: 'organizationName', value: name });
  subject.push({ type: '2.5.4.97', value: `VAT${country}-${taxId}` });
}
cert.setSubject(subject);
cert.setIssuer(subject);
cert.setExtensions([
  { name: 'basicConstraints', cA: false },
  { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
]);
cert.sign(keys.privateKey, forge.md.sha256.create());

const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], values.password, {
  algorithm: '3des',
  friendlyName: name,
});
writeFileSync(out, Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'));
// The password is not echoed: it is the one passed with --password, or the default documented in
// tools/fixtures/ecf-certificates/README.md.
console.log(`${out} — titular «${name}» (${country} ${taxId}${person ? ', persona' : ''}).`);
console.log('Autofirmado: solo para desarrollo, con ECF_ALLOW_TEST_CERTIFICATES=true.');
