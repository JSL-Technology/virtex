import { plainToInstance } from 'class-transformer';
import { UserResponseDto } from './user-response.dto';

/**
 * H3 FIX (contract test): the user payload returned to clients must never carry secret or
 * sensitive material. `UserResponseDto` relies on `@Expose()` + `excludeExtraneousValues: true`
 * to whitelist fields, so any field that is not explicitly exposed must be dropped. This test
 * locks that contract so a future `@Expose()` on the wrong field — or a switch away from
 * `excludeExtraneousValues` — fails CI instead of silently leaking secrets.
 * (OWASP API3 Excessive Data Exposure; ASVS data minimization; CWE-200/CWE-922.)
 */
describe('UserResponseDto serialization contract', () => {
  // A "dirty" source object mimicking a raw User entity joined with its security relation.
  const dirtyUser = {
    id: 'user-uuid',
    email: 'user@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    status: 'ACTIVE',
    organizationId: 'org-uuid',
    preferredLanguage: 'es',
    isPhoneVerified: true,
    isTwoFactorEnabled: true,
    permissions: ['users:view'],
    organization: {
      id: 'org-uuid',
      legalName: 'Acme',
      taxId: 'RNC-1',
      logoUrl: 'https://cdn.example/logo.png',
      subscriptionStatus: 'active',
      gracePeriodEnd: null,
      // Billing identifiers must never reach the client: they are useful to an attacker
      // enumerating billing accounts and the UI has no use for them.
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
    },

    // --- Fields that MUST NOT survive serialization ---
    token: 'eyJhbGciOi.aaa.bbb',
    accessToken: 'eyJhbGciOi.ccc.ddd',
    refreshToken: 'eyJhbGciOi.eee.fff',
    password: 'PlaintextSecret123!',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
    security: {
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
      twoFactorSecret: 'JBSWY3DPEHPK3PXP',
      backupCodes: ['code-1', 'code-2'],
      tokenVersion: 7,
      emailChangeToken: 'change-token',
    },
    twoFactorSecret: 'JBSWY3DPEHPK3PXP',
    backupCodes: ['code-1', 'code-2'],
    invitationToken: 'invite-token',
  };

  const SECRET_FIELDS = [
    'token',
    'accessToken',
    'refreshToken',
    'password',
    'passwordHash',
    'security',
    'twoFactorSecret',
    'backupCodes',
    'invitationToken',
  ] as const;

  const serialize = () =>
    plainToInstance(UserResponseDto, dirtyUser, { excludeExtraneousValues: true });

  it.each(SECRET_FIELDS)('does not expose the "%s" field', (field) => {
    const result = serialize() as unknown as Record<string, unknown>;
    expect(result).not.toHaveProperty(field);
  });

  it('exposes the whitelisted, non-sensitive fields', () => {
    const result = serialize() as unknown as Record<string, unknown>;
    for (const field of [
      'id',
      'email',
      'firstName',
      'lastName',
      'status',
      'organizationId',
      'preferredLanguage',
      'isPhoneVerified',
      'isTwoFactorEnabled',
      'permissions',
      'organization',
    ]) {
      expect(result).toHaveProperty(field);
    }
  });

  it('never leaks a secret field even if new properties are added to the source', () => {
    const result = serialize() as unknown as Record<string, unknown>;
    const leaked = Object.keys(result).filter((k) =>
      (SECRET_FIELDS as readonly string[]).includes(k),
    );
    expect(leaked).toEqual([]);
  });

  it('strips secrets from the nested organization object', () => {
    const result = serialize() as unknown as { organization: Record<string, unknown> };
    expect(Object.keys(result.organization).sort()).toEqual(
      [
        'id',
        'legalName',
        'taxId',
        'logoUrl',
        'subscriptionStatus',
        'gracePeriodEnd',
        // Locale context: what the browser cannot infer and needs in order to format an amount
        // or an accounting date the way this tenant reads them.
        'countryCode',
        'currency',
        'timezone',
        'booksLanguage',
      ].sort(),
    );
  });

  it('never exposes billing identifiers on the organization', () => {
    const result = serialize() as unknown as { organization: Record<string, unknown> };
    expect(result.organization).not.toHaveProperty('stripeCustomerId');
    expect(result.organization).not.toHaveProperty('stripeSubscriptionId');
  });

  it('normalises roles to an array so the UI can map over it safely', () => {
    // The members list does `user.roles.map(...)`. An undefined here is a runtime crash, not an
    // empty state, so the DTO must always emit an array even when the relation was not loaded.
    const result = serialize() as { roles: unknown; organizations: unknown; permissions: unknown };
    expect(Array.isArray(result.roles)).toBe(true);
    expect(Array.isArray(result.organizations)).toBe(true);
    expect(Array.isArray(result.permissions)).toBe(true);
  });

  it('exposes the profile fields the UI renders', () => {
    // These were previously absent from the DTO while the frontend declared and rendered them,
    // so they arrived as undefined: the members list showed "Sin rol" and the profile screen
    // could not display — or persist — the user's own phone number.
    const result = serialize() as unknown as Record<string, unknown>;
    for (const field of ['roles', 'avatarUrl', 'phone', 'jobTitle', 'department', 'isOnline', 'isEmailVerified']) {
      expect(result).toHaveProperty(field);
    }
  });
});
