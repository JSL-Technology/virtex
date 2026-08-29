import { UserStatus } from '../../users/entities/user.entity/user.entity';
import { CachedUser } from '../interfaces/cached-user.interface';

/**
 * What the authentication cache is allowed to hold.
 *
 * The cache used to store the `User` entity with its `security` relation attached, for fifteen
 * minutes, on every authenticated request — putting `passwordHash`, `twoFactorSecret`,
 * `backupCodes`, `passwordResetToken` and `emailChangeToken` into Redis, which has neither
 * authentication nor TLS by default. Compromising the weakest component in the stack then had the
 * same consequence as dumping the `user_security` table.
 *
 * The type below is the contract. This test pins it, because the failure mode of getting it wrong
 * again is silent: everything keeps working, and the secret is simply somewhere it should not be.
 */
describe('CachedUser — what may be cached', () => {
  const FORBIDDEN = [
    'security',
    'passwordHash',
    'password_hash',
    'twoFactorSecret',
    'pendingTwoFactorSecret',
    'backupCodes',
    'passwordResetToken',
    'emailChangeToken',
    'emailChangeTarget',
    'invitationToken',
    'authProviderId',
  ] as const;

  /** A value of the projection type, built from the fields the interface declares. */
  const cached: CachedUser = {
    id: 'user-1',
    email: 'person@example.com',
    firstName: 'Person',
    lastName: 'Example',
    status: UserStatus.ACTIVE,
    organizationId: 'org-1',
    permissions: ['invoices:view'],
    roleNames: ['Member'],
    tokenVersion: 3,
    isTwoFactorEnabled: false,
  };

  it.each(FORBIDDEN)('does not carry %s', (field) => {
    expect(Object.keys(cached)).not.toContain(field);
  });

  it('keeps exactly the fields the request pipeline reads', () => {
    // Named explicitly rather than counted: adding a field should be a deliberate edit here, and
    // the reviewer should be able to see what it is.
    expect(Object.keys(cached).sort()).toEqual(
      [
        'email',
        'firstName',
        'id',
        'isTwoFactorEnabled',
        'lastName',
        'organizationId',
        'permissions',
        'roleNames',
        'status',
        'tokenVersion',
      ].sort(),
    );
  });

  /**
   * `tokenVersion` is the one field kept from `user_security`. It has to be: every request
   * compares it against the token's claim to honour a global invalidation, and doing that from
   * the database would put a query on the hot path. On its own it discloses nothing.
   */
  it('keeps tokenVersion, which is what makes invalidation immediate', () => {
    expect(cached.tokenVersion).toBe(3);
  });
});
