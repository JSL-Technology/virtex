import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { AuthConfig } from '../auth.config';
import { BadRequestError } from '../../i18n/localized.exception';

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  /**
   * Verify a password against an Argon2 hash.
   *
   * `argon2.verify` throws — it does not return false — when the stored value is not a parseable
   * encoded hash (a truncated column, a legacy bcrypt row, an empty string). Left uncaught that
   * surfaced as a 500 on the login path, turning a data problem into an outage and signalling,
   * through the error type, that something about *this specific account* was unusual. A malformed
   * hash simply means the password cannot be confirmed: that is `false`.
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch (error) {
      this.logger.error(
        { event: 'password_verify_error' },
        `Password verification failed against a malformed or unsupported hash: ${(error as Error).message}`,
      );
      return false;
    }
  }

  async hash(plain: string): Promise<string> {
    // L-12: apply the configured Argon2id parameters explicitly. They were previously dead
    // config — argon2.hash used library defaults — so operational tuning had no effect.
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: AuthConfig.ARGON2_MEMORY_COST,
      timeCost: AuthConfig.ARGON2_TIME_COST,
      parallelism: AuthConfig.ARGON2_PARALLELISM,
    });
  }

  /**
   * Whether a stored hash was produced with weaker parameters than we now require.
   *
   * Raising ARGON2_* only protects passwords hashed afterwards; existing rows keep their original
   * cost forever unless re-hashed. Login is the one moment the plaintext is legitimately in
   * memory, so it is the only opportunity to upgrade them transparently.
   */
  needsRehash(hash: string): boolean {
    try {
      // `type` is not a `needsRehash` option — the variant is read from the hash string itself,
      // which is the whole point of the encoded prefix. Passing it here was silently ignored.
      return argon2.needsRehash(hash, {
        memoryCost: AuthConfig.ARGON2_MEMORY_COST,
        timeCost: AuthConfig.ARGON2_TIME_COST,
        parallelism: AuthConfig.ARGON2_PARALLELISM,
      });
    } catch {
      // Unparseable: treat as needing replacement.
      return true;
    }
  }

  /**
   * Equalise timing for accounts that do not exist or have no password set.
   *
   * Without it, "unknown email" returns in microseconds while a real account pays the full
   * Argon2 cost — a difference large enough to enumerate accounts.
   */
  async verifyDummy(plain: string): Promise<void> {
    try {
      await argon2.verify(AuthConfig.DUMMY_PASSWORD_HASH, plain);
    } catch {
      // Expected: the dummy comparison never matches. Nothing to do.
    }
  }

  /**
   * Reject passwords that appear in known breach corpora, via the Have I Been Pwned range API.
   *
   * NIST SP 800-63B §5.1.1.2 requires screening candidate secrets against known-compromised
   * values, and it is the highest-value password control available: composition rules mostly push
   * users toward predictable patterns, whereas breach screening blocks precisely the credentials
   * used in real credential-stuffing attacks.
   *
   * k-anonymity: only the first five characters of the SHA-1 digest leave the server, so the API
   * learns neither the password nor its full hash.
   *
   * Fails OPEN by deliberate trade-off: an outage at a third party must not stop people from
   * signing up or changing their password. Every other control (length, policy, Argon2id) is
   * independent of it and still applies.
   */
  async assertNotBreached(plain: string): Promise<void> {
    if (!AuthConfig.PASSWORD_BREACH_CHECK_ENABLED) return;

    const digest = crypto.createHash('sha1').update(plain).digest('hex').toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);

    let body: string;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      AuthConfig.PASSWORD_BREACH_API_TIMEOUT_MS,
    );

    try {
      const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        signal: controller.signal,
        headers: {
          'Add-Padding': 'true', // pads the response so its size reveals nothing
          'User-Agent': 'Virteex-Auth',
        },
      });
      if (!response.ok) return;
      body = await response.text();
    } catch (error) {
      this.logger.warn(
        { event: 'breach_check_unavailable' },
        `Password breach check skipped: ${(error as Error).message}`,
      );
      return;
    } finally {
      clearTimeout(timeout);
    }

    for (const line of body.split('\n')) {
      const [hashSuffix, countRaw] = line.trim().split(':');
      if (hashSuffix !== suffix) continue;
      // Padded responses include synthetic entries with a count of 0; those are not real hits.
      if (Number(countRaw) > 0) {
        throw new BadRequestError('AUTH.ESTA_CONTRASENA_APARECE_FILTRACIONES_DATOS_CONOCIDAS_ELIGE');
      }
      return;
    }
  }
}
