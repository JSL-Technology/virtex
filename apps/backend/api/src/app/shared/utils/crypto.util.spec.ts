import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { CryptoUtil } from './crypto.util';

/**
 * One primitive, one format, and everything the four previous ones wrote still readable.
 *
 * There were four derivations of a key from `ENCRYPTION_SECRET` in this codebase, with three
 * different serialisations between them — and two of those wrote the SAME column
 * (`refresh_tokens.encrypted_ip`), one as `iv:tag:ct` and the other as `iv:ct:tag`. Nothing read
 * the column, so nothing ever noticed; the forensic capability it exists to provide did not
 * exist.
 *
 * These tests pin both halves of the fix: what is written now, and that nothing already stored
 * became unreadable in the process.
 */
describe('CryptoUtil', () => {
  const SECRET = 'a'.repeat(64);
  const SALT = 'b'.repeat(32);

  function build(env: Record<string, string> = {}): CryptoUtil {
    const config = {
      get: (key: string) => ({ ENCRYPTION_SECRET: SECRET, AUTH_SALT: SALT, ...env })[key],
      getOrThrow: (key: string) => {
        const value = ({ ENCRYPTION_SECRET: SECRET, AUTH_SALT: SALT, ...env })[key];
        if (value === undefined) throw new Error(`Missing configuration: ${key}`);
        return value;
      },
    } as unknown as ConfigService;
    return new CryptoUtil(config);
  }

  /** Reproduce, byte for byte, what each historical implementation wrote. */
  function legacy(shape: 'iv:tag:ct' | 'iv:ct:tag', plaintext: string, ivLength = 12): string {
    const key = crypto.scryptSync(SECRET, SALT, 32);
    const iv = crypto.randomBytes(ivLength);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return shape === 'iv:tag:ct'
      ? `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`
      : `${iv.toString('hex')}:${ct.toString('hex')}:${tag.toString('hex')}`;
  }

  it('round-trips a value', () => {
    const util = build();
    expect(util.decrypt(util.encrypt('203.0.113.7'))).toBe('203.0.113.7');
  });

  it('writes the versioned format, so the next migration does not need trial decryption', () => {
    const sealed = build().encrypt('hello');
    expect(sealed.startsWith('v2:')).toBe(true);
    expect(sealed.split(':')).toHaveLength(4);
    expect(CryptoUtil.isCurrentFormat(sealed)).toBe(true);
  });

  it('never produces the same ciphertext twice for the same plaintext', () => {
    const util = build();
    expect(util.encrypt('same')).not.toBe(util.encrypt('same'));
  });

  describe('reads what the previous implementations wrote', () => {
    // The ambiguity these two resolve is real: both are three hex fields separated by colons, and
    // only GCM authentication can tell them apart.
    it('reads the `iv:tag:ct` shape this class used to write (TOTP secrets)', () => {
      expect(build().decrypt(legacy('iv:tag:ct', 'JBSWY3DPEHPK3PXP'))).toBe('JBSWY3DPEHPK3PXP');
    });

    it('reads the `iv:ct:tag` shape SecretEncryptionService wrote (IdP client secrets)', () => {
      expect(build().decrypt(legacy('iv:ct:tag', 'client-secret'))).toBe('client-secret');
    });

    it('reads TokenService\'s 16-byte-IV variant (half of encrypted_ip)', () => {
      // GCM accepts a non-standard IV length; the point is that the two writers of one column
      // differed in the IV width as well as the field order.
      expect(build().decrypt(legacy('iv:ct:tag', '198.51.100.9', 16))).toBe('198.51.100.9');
    });

    it('reads the original AES-256-CBC two-field shape', () => {
      const key = crypto.scryptSync(SECRET, SALT, 32);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      const ct = cipher.update('legacy-cbc', 'utf8', 'hex') + cipher.final('hex');
      expect(build().decrypt(`${iv.toString('hex')}:${ct}`)).toBe('legacy-cbc');
    });
  });

  describe('key rotation', () => {
    it('reads what the previous secret sealed, and rewrites with the current one', () => {
      const PREVIOUS = 'c'.repeat(64);
      const old = build({ ENCRYPTION_SECRET: PREVIOUS }).encrypt('rotate-me');

      const rotating = build({ ENCRYPTION_SECRET_PREVIOUS: PREVIOUS });
      expect(rotating.decrypt(old)).toBe('rotate-me');

      // Written with the CURRENT key, so data re-encrypts itself as it is touched and the old
      // secret can eventually be dropped.
      const rewritten = rotating.encrypt('rotate-me');
      expect(build().decrypt(rewritten)).toBe('rotate-me');
    });

    it('refuses a value no key in the ring authenticates', () => {
      const foreign = build({ ENCRYPTION_SECRET: 'd'.repeat(64) }).encrypt('not-ours');
      expect(() => build().decrypt(foreign)).toThrow(/no key in the ring/);
    });
  });

  describe('refuses what it cannot trust', () => {
    it('rejects a tampered ciphertext (GCM authentication)', () => {
      const util = build();
      const [version, iv, ct, tag] = util.encrypt('honest').split(':');
      const flipped = (parseInt(ct.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, '0');
      expect(() => util.decrypt(`${version}:${iv}:${flipped}${ct.slice(2)}:${tag}`)).toThrow();
    });

    it('rejects a truncated authentication tag', () => {
      const util = build();
      const [version, iv, ct, tag] = util.encrypt('honest').split(':');
      expect(() => util.decrypt(`${version}:${iv}:${ct}:${tag.slice(0, 8)}`)).toThrow();
    });

    it('rejects a shape it does not recognise', () => {
      expect(() => build().decrypt('nonsense')).toThrow(/Invalid encryption format/);
    });
  });

  it('refuses to construct without the secret, rather than falling back to a literal', () => {
    // The previous implementation defaulted the salt to 'default-salt-change-me-in-prod' whenever
    // AUTH_SALT was absent and NODE_ENV was not exactly 'production' — a value auth.config.ts
    // itself classifies as an insecure placeholder, on a path that classification never reached.
    const config = {
      get: () => undefined,
      getOrThrow: (key: string) => {
        throw new Error(`Missing configuration: ${key}`);
      },
    } as unknown as ConfigService;

    expect(() => new CryptoUtil(config)).toThrow(/ENCRYPTION_SECRET/);
  });
});
