#!/usr/bin/env node
/**
 * Generates a SELF-SIGNED PKCS#12 to exercise the e-CF signing flow in development.
 *
 *   node tools/dev/generate-test-ecf-certificate.mjs --rnc 130456781 --name "Colmado La Esquina SRL"
 *   node tools/dev/generate-test-ecf-certificate.mjs --cedula 00112345678 --name "Laura Martínez"
 *
 * What it is for: uploading a certificate in Ajustes › Facturación electrónica and issuing e-CF
 * (serie E) end to end on a local machine — numbering, XML signature, ledger, PDF and e-mail.
 *
 * What it is NOT: a certificate the DGII accepts. Only an entity the DGII authorises can issue
 * one, to the taxpayer's own RNC (or to the cédula of the person the taxpayer authorised). The
 * API refuses a self-signed certificate unless the process is a development or test environment
 * AND `ECF_ALLOW_TEST_CERTIFICATES=true` — see `CertificateInspector`.
 *
 * The holder's identifier is written where real certificates carry it: the subject's
 * `serialNumber` (2.5.4.5) and `organizationIdentifier` (2.5.4.97) attributes. That is what lets
 * the upload check that the certificate belongs to the company.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import forge from 'node-forge';

const { values } = parseArgs({
  options: {
    rnc: { type: 'string' },
    cedula: { type: 'string' },
    name: { type: 'string' },
    password: { type: 'string', default: 'virtex-pruebas' },
    days: { type: 'string', default: '365' },
    out: { type: 'string' },
  },
});

const rnc = values.rnc?.replace(/\D/g, '');
const cedula = values.cedula?.replace(/\D/g, '');
if ((!rnc && !cedula) || (rnc && cedula)) {
  console.error('Pass exactly one of --rnc <9 digits> or --cedula <11 digits>.');
  process.exit(1);
}
if (rnc && rnc.length !== 9) {
  console.error('An RNC has 9 digits.');
  process.exit(1);
}
if (cedula && cedula.length !== 11) {
  console.error('A cédula has 11 digits.');
  process.exit(1);
}
const holderId = rnc ?? cedula;
const name = values.name ?? (rnc ? `Empresa de pruebas ${rnc}` : `Persona de pruebas ${cedula}`);
const out = values.out ?? `test-ecf-${holderId}.p12`;

const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(15));
cert.validity.notBefore = new Date(Date.now() - 60_000);
cert.validity.notAfter = new Date(Date.now() + Number(values.days) * 86_400_000);

const subject = [
  { name: 'commonName', value: name },
  { shortName: 'C', value: 'DO' },
  { shortName: 'OU', value: 'PRUEBAS - NO VALIDO ANTE LA DGII' },
  { type: '2.5.4.5', value: rnc ? `RNC${rnc}` : `IDCDO-${cedula}` },
];
if (rnc) {
  subject.push({ name: 'organizationName', value: name });
  subject.push({ type: '2.5.4.97', value: `VATDO-${rnc}` });
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
console.log(`${out} — titular «${name}» (${rnc ? 'RNC' : 'cédula'} ${holderId}), contraseña «${values.password}».`);
console.log('Autofirmado: solo para desarrollo, con ECF_ALLOW_TEST_CERTIFICATES=true.');
