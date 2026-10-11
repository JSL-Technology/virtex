import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TestCertificate {
  pfx: Buffer;
  password: string;
  certPem: string;
}

/**
 * A throwaway self-signed PKCS#12, so signing is exercised for real rather than stubbed.
 *
 * Shared by every verifier that needs one: issuing an electronic document now requires a valid
 * signing certificate, so any script that issues has to load one first, exactly as a tenant must.
 */
export function makeTestCertificate(commonName = 'SONDA e-CF', days = 30, holderId?: string): TestCertificate {
  // The holder's fiscal identifier (RNC, NIT, RFC…) where certification authorities write it, so
  // the upload can tie the certificate to the company — one that names nobody is refused (QA V01).
  const id = holderId?.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const subject = `/CN=${commonName}${id ? `/serialNumber=${id}` : ''}`;
  const dir = mkdtempSync(join(tmpdir(), 'virteex-cert-'));
  try {
    const password = 'sonda-ecf';
    const key = join(dir, 'key.pem');
    const cert = join(dir, 'cert.pem');
    const p12 = join(dir, 'test.p12');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert,
      '-days', String(days), '-nodes', '-subj', subject,
      '-addext', 'keyUsage=critical,digitalSignature,nonRepudiation',
    ], { stdio: 'ignore' });
    try {
      execFileSync('openssl', [
        'pkcs12', '-export', '-out', p12, '-inkey', key, '-in', cert, '-passout', `pass:${password}`, '-legacy',
      ], { stdio: 'ignore' });
    } catch {
      // OpenSSL 1.x has no `-legacy` and already writes the legacy format.
      execFileSync('openssl', [
        'pkcs12', '-export', '-out', p12, '-inkey', key, '-in', cert, '-passout', `pass:${password}`,
      ], { stdio: 'ignore' });
    }
    return { pfx: readFileSync(p12), password, certPem: readFileSync(cert, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
