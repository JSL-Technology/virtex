import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as forge from 'node-forge';
import { SigningCertificate } from '../entities/signing-certificate.entity';
import { BadRequestError, InternalServerError } from '../../i18n/localized.exception';
import { isDevLikeEnvironment } from '../../config/environment';
import { CertificateFacts, inspectCertificate } from './certificate-inspector';

export interface LoadedCertificate {
  privateKeyPem: string;
  certificatePem: string;
  subjectCommonName?: string;
  serialNumber?: string;
  notBefore?: Date;
  notAfter?: Date;
}

/** A parsed certificate with who it was issued to and by whom (see `certificate-inspector`). */
export type InspectedCertificate = LoadedCertificate & {
  facts: CertificateFacts;
  /** The holder's certificate, and the other certificates the file carries (its chain). */
  leaf: forge.pki.Certificate;
  intermediates: forge.pki.Certificate[];
};

/**
 * Encrypts signing certificates at rest and materializes their private key / X.509 in memory
 * only at signing time. Encryption is AES-256-GCM with a key derived (scrypt) from the configured
 * `SIGNING_CERT_ENCRYPTION_KEY`, so the database never stores the PKCS#12 bytes or its password in
 * the clear. This replaces the previous stub that hardcoded a fake `'---BEGIN PRIVATE KEY---...'`.
 *
 * ## The stored shape, and why it carries a version
 *
 * `v2:salt:iv:tag:data`, each part base64 — the same idiom as the payroll column transformer, which
 * puts a key id in front of the ciphertext so the derivation can be changed without making every
 * stored value unreadable. The salt is RANDOM PER RECORD: scrypt's salt is what stops one derived
 * key covering the whole deployment, and a single constant for every tenant's certificate gave
 * exactly that. A certificate written before this carries the legacy three-part form and is still
 * read, under {@link LEGACY_SALT}; nothing is written under it again.
 */
@Injectable()
export class CertificateVaultService {
  private readonly logger = new Logger(CertificateVaultService.name);
  private static readonly VERSION = 'v2';
  private static readonly SALT_BYTES = 16;
  private static readonly IV_BYTES = 12;

  constructor(private readonly config: ConfigService) {}

  private secret(): string {
    const secret = this.config.get<string>('SIGNING_CERT_ENCRYPTION_KEY');
    if (!secret || secret.length < 16) {
      throw new InternalServerError('einvoicing.signing_cert_encryption_key_not_configured');
    }
    return secret;
  }

  private key(salt: Buffer | string): Buffer {
    return crypto.scryptSync(this.secret(), salt, 32);
  }

  encrypt(plaintext: Buffer | string): string {
    const salt = crypto.randomBytes(CertificateVaultService.SALT_BYTES);
    const iv = crypto.randomBytes(CertificateVaultService.IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key(salt), iv);
    const data = Buffer.concat([
      cipher.update(typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      CertificateVaultService.VERSION,
      salt.toString('base64'),
      iv.toString('base64'),
      authTag.toString('base64'),
      data.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string): Buffer {
    const parts = payload.split(':');
    const [ivB64, tagB64, dataB64] =
      parts.length === 3 ? parts : parts.length === 5 && parts[0] === CertificateVaultService.VERSION ? parts.slice(2) : [];
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new InternalServerError('einvoicing.certificate_encrypted_data_format_invalid');
    }
    const salt = parts.length === 5 ? Buffer.from(parts[1], 'base64') : LEGACY_SALT;
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(salt), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  }

  /**
   * Parses a PKCS#12 (.p12/.pfx) with its password, validating it up front and returning the PEM
   * material plus certificate metadata. Throws a `BadRequestException` (not 500) on a bad password
   * or malformed file, because that is user-correctable input.
   */
  parsePkcs12(pfx: Buffer, password: string): InspectedCertificate {
    let p12: forge.pkcs12.Pkcs12Pfx;
    try {
      const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
      p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
    } catch {
      throw new BadRequestError('einvoicing.certificate_could_not_opened_invalid_file');
    }

    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
    const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
      .map((bag) => bag.cert)
      .filter((cert): cert is forge.pki.Certificate => Boolean(cert));
    if (!keyBag?.key || certs.length === 0) {
      throw new BadRequestError('einvoicing.certificate_does_not_contain_valid_private');
    }

    // The holder's certificate is the one whose public key matches the private key — not the first
    // in the file: a file that lists its CA first was read as the CA's certificate.
    const privateKey = keyBag.key as forge.pki.rsa.PrivateKey;
    const cert =
      certs.find((candidate) => {
        const publicKey = candidate.publicKey as forge.pki.rsa.PublicKey;
        return Boolean(publicKey?.n && privateKey?.n && publicKey.n.equals(privateKey.n));
      }) ?? certs[0];
    const cnField = cert.subject.getField('CN');
    return {
      privateKeyPem: forge.pki.privateKeyToPem(keyBag.key),
      certificatePem: forge.pki.certificateToPem(cert),
      subjectCommonName: cnField?.value,
      serialNumber: cert.serialNumber,
      notBefore: cert.validity?.notBefore,
      notAfter: cert.validity?.notAfter,
      facts: inspectCertificate(cert),
      leaf: cert,
      intermediates: certs.filter((candidate) => candidate !== cert),
    };
  }

  /**
   * Whether a self-signed certificate may be used: only in a development or test process that
   * opted in with `SIGNING_ALLOW_TEST_CERTIFICATES=true`. Configuration validation already refuses the
   * flag anywhere else; this checks the environment again so a forgotten flag can never be enough.
   */
  testCertificatesAllowed(): boolean {
    return isDevLikeEnvironment() && String(this.config.get('SIGNING_ALLOW_TEST_CERTIFICATES')) === 'true';
  }

  /** Decrypts a stored certificate and returns its usable PEM material for signing. */
  load(certificate: SigningCertificate): LoadedCertificate {
    const pfx = this.decrypt(certificate.encryptedPfx);
    const password = this.decrypt(certificate.encryptedPassword).toString('utf8');
    return this.parsePkcs12(pfx, password);
  }
}

/**
 * The single salt every certificate was derived with before the versioned shape.
 *
 * FROZEN CIPHERTEXT INPUT, not vocabulary: its bytes are what `scrypt` was given, so a certificate
 * stored under it stops decrypting the moment this string changes — the taxpayer would have to
 * upload its PKCS#12 again. It is read-only: {@link CertificateVaultService.encrypt} never uses it.
 * It reads `ecf` because the product's only electronic documents were one market's when it was
 * written, which is exactly the coupling the market packages removed everywhere it was reversible.
 */
const LEGACY_SALT = 'virteex.ecf.cert.v1';
