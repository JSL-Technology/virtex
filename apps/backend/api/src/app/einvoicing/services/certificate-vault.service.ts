import { Injectable, InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as forge from 'node-forge';
import { EcfCertificate } from '../entities/ecf-certificate.entity';

export interface LoadedCertificate {
  privateKeyPem: string;
  certificatePem: string;
  subjectCommonName?: string;
  serialNumber?: string;
  notBefore?: Date;
  notAfter?: Date;
}

/**
 * Encrypts DGII signing certificates at rest and materializes their private key / X.509 in memory
 * only at signing time. Encryption is AES-256-GCM with a key derived (scrypt) from the configured
 * `ECF_CERT_ENCRYPTION_KEY`, so the database never stores the PKCS#12 bytes or its password in the
 * clear. This replaces the previous stub that hardcoded a fake `'---BEGIN PRIVATE KEY---...'`.
 */
@Injectable()
export class CertificateVaultService {
  private readonly logger = new Logger(CertificateVaultService.name);
  private static readonly SALT = 'virteex.ecf.cert.v1';
  private static readonly IV_BYTES = 12;

  constructor(private readonly config: ConfigService) {}

  private key(): Buffer {
    const secret = this.config.get<string>('ECF_CERT_ENCRYPTION_KEY');
    if (!secret || secret.length < 16) {
      throw new InternalServerErrorException(
        'ECF_CERT_ENCRYPTION_KEY no está configurada (mínimo 16 caracteres). Es obligatoria para cifrar los certificados e-CF.',
      );
    }
    return crypto.scryptSync(secret, CertificateVaultService.SALT, 32);
  }

  encrypt(plaintext: Buffer | string): string {
    const iv = crypto.randomBytes(CertificateVaultService.IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key(), iv);
    const data = Buffer.concat([
      cipher.update(typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [iv.toString('base64'), authTag.toString('base64'), data.toString('base64')].join(':');
  }

  decrypt(payload: string): Buffer {
    const parts = payload.split(':');
    if (parts.length !== 3) {
      throw new InternalServerErrorException('Formato de dato cifrado de certificado inválido.');
    }
    const [ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  }

  /**
   * Parses a PKCS#12 (.p12/.pfx) with its password, validating it up front and returning the PEM
   * material plus certificate metadata. Throws a `BadRequestException` (not 500) on a bad password
   * or malformed file, because that is user-correctable input.
   */
  parsePkcs12(pfx: Buffer, password: string): LoadedCertificate {
    let p12: forge.pkcs12.Pkcs12Pfx;
    try {
      const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
      p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
    } catch {
      throw new BadRequestException('No se pudo abrir el certificado: archivo inválido o contraseña incorrecta.');
    }

    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = certBags[forge.pki.oids.certBag]?.[0];

    if (!keyBag?.key || !certBag?.cert) {
      throw new BadRequestException('El certificado no contiene una clave privada y un certificado X.509 válidos.');
    }

    const cert = certBag.cert;
    const cnField = cert.subject.getField('CN');
    return {
      privateKeyPem: forge.pki.privateKeyToPem(keyBag.key),
      certificatePem: forge.pki.certificateToPem(cert),
      subjectCommonName: cnField?.value,
      serialNumber: cert.serialNumber,
      notBefore: cert.validity?.notBefore,
      notAfter: cert.validity?.notAfter,
    };
  }

  /** Decrypts a stored certificate and returns its usable PEM material for signing. */
  load(certificate: EcfCertificate): LoadedCertificate {
    const pfx = this.decrypt(certificate.encryptedPfx);
    const password = this.decrypt(certificate.encryptedPassword).toString('utf8');
    return this.parsePkcs12(pfx, password);
  }
}
