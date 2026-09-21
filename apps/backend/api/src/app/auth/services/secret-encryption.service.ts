import { Injectable } from '@nestjs/common';
import { CryptoUtil } from '../../shared/utils/crypto.util';
import { InternalServerError } from '../../i18n/localized.exception';

/**
 * Authenticated encryption for secrets stored at rest, such as enterprise IdP client secrets.
 *
 * This used to carry its own scrypt derivation and its own `iv:ct:tag` serialisation, which made
 * it the second of three incompatible implementations of the same idea — and the one that also
 * fell back to a hardcoded key (`'dev-secret-encryption'`) whenever `ENCRYPTION_SECRET` was absent
 * and NODE_ENV was not exactly `production`.
 *
 * It is now a thin, named façade over {@link CryptoUtil}: the call sites keep reading as what they
 * are (encrypting an IdP secret, not "using the crypto utility"), the domain-specific error
 * message is preserved, and there is exactly one key derivation and one format in the process.
 * Values written by the previous implementation are still readable — `CryptoUtil.decrypt`
 * resolves the old three-part shape by trial decryption.
 */
@Injectable()
export class SecretEncryptionService {
  constructor(private readonly crypto: CryptoUtil) {}

  encrypt(plaintext: string): string {
    return this.crypto.encrypt(plaintext);
  }

  decrypt(payload: string): string {
    try {
      return this.crypto.decrypt(payload);
    } catch {
      // Deliberately opaque: the caller is an HTTP request and the reason a stored secret will not
      // decrypt (wrong key, truncated column, tampered row) is not something to report outward.
      throw new InternalServerError('auth.stored_secret_could_not_decrypted');
    }
  }
}
