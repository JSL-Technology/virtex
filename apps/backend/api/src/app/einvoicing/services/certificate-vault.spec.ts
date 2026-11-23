import { CertificateVaultService } from './certificate-vault.service';

/**
 * The envelope a signing certificate is stored in.
 *
 * It had no test at all, which is how it kept a shape nobody was checking. Two things were wrong
 * with it and both are pinned here:
 *
 *  1. **One salt for the whole installation.** `scrypt` was given a constant, so every tenant's
 *     certificate in a deployment was sealed under the same derived key. A salt exists precisely
 *     to stop that. It is random per record now, and it travels in the envelope.
 *  2. **A legacy branch for the constant-salt shape.** Its value was the product's old, misspelled
 *     name, so the rename that corrected the name would have silently broken decryption — a
 *     compatibility path for ciphertext nobody can read without the old string. It is gone: that
 *     shape is refused with a message that says what to do.
 */
describe('CertificateVaultService — the stored envelope', () => {
  const CONFIGURED = 'una-clave-de-cifrado-suficientemente-larga';
  /** `withKey(undefined)` is a deployment with no key, not the default one: hence two functions. */
  const withKey = (secret: string | undefined) => new CertificateVaultService({ get: () => secret } as never);
  const vault = () => withKey(CONFIGURED);

  it('round-trips what it sealed', () => {
    const service = vault();
    const sealed = service.encrypt(Buffer.from('material del certificado'));
    expect(service.decrypt(sealed).toString('utf8')).toBe('material del certificado');
  });

  it('seals the same plaintext differently every time, salt and IV both', () => {
    const service = vault();
    const [first, second] = [service.encrypt('igual'), service.encrypt('igual')];
    expect(first).not.toBe(second);

    const saltOf = (payload: string) => payload.split(':')[1];
    const ivOf = (payload: string) => payload.split(':')[2];
    // A constant salt was the defect: with it, two tenants' certificates shared a derived key.
    expect(saltOf(first)).not.toBe(saltOf(second));
    expect(ivOf(first)).not.toBe(ivOf(second));
  });

  it('carries its version, so the derivation can change without orphaning what is stored', () => {
    expect(vault().encrypt('x').split(':')).toHaveLength(5);
    expect(vault().encrypt('x').startsWith('v2:')).toBe(true);
  });

  it('refuses the retired constant-salt shape with a message that says what to do', () => {
    // `iv:tag:data`: the three-part form, written before the envelope was versioned.
    expect(() => vault().decrypt('aXY=:dGFn:ZGF0YQ==')).toThrow(
      expect.objectContaining({ messageKey: 'einvoicing.certificate.stored_in_a_retired_format' }),
    );
  });

  it('refuses anything else as a malformed envelope, not as a bad certificate', () => {
    expect(() => vault().decrypt('v2:only:three:parts')).toThrow(
      expect.objectContaining({ messageKey: 'einvoicing.certificate_encrypted_data_format_invalid' }),
    );
    expect(() => vault().decrypt('v1:a:b:c:d')).toThrow(
      expect.objectContaining({ messageKey: 'einvoicing.certificate_encrypted_data_format_invalid' }),
    );
  });

  it('tampering with the ciphertext is a decrypt failure, not a wrong certificate', () => {
    const service = vault();
    const parts = service.encrypt('material').split(':');
    parts[4] = Buffer.from('otro material').toString('base64');
    expect(() => service.decrypt(parts.join(':'))).toThrow();
  });

  it('will not operate at all without a configured key', () => {
    expect(() => withKey(undefined).encrypt('x')).toThrow(
      expect.objectContaining({ messageKey: 'einvoicing.signing_cert_encryption_key_not_configured' }),
    );
    // Too short counts as not configured: a sixteen-character minimum is the schema's rule too.
    expect(() => withKey('corta').encrypt('x')).toThrow(
      expect.objectContaining({ messageKey: 'einvoicing.signing_cert_encryption_key_not_configured' }),
    );
  });
});
