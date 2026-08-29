import { UserIdentityService } from './user-identity.service';
import { CachedUser } from '../interfaces/cached-user.interface';
import { UserStatus } from '../../users/entities/user.entity/user.entity';
import { TokenService } from './token.service';
import { User } from '../../users/entities/user.entity/user.entity';

/**
 * Permissions belong to a tenant, not to a person.
 *
 * Roles carry `organization_id` and a user can hold roles in several tenants at once — the whole
 * multi-tenancy model depends on that. Permissions were nonetheless computed as
 * `[...new Set(user.roles.flatMap((role) => role.permissions))]`, with no filter, in three
 * separate places. Somebody who administered one customer and merely viewed another therefore
 * arrived at the second one holding administrator rights.
 *
 * The tenant-context check that decided WHICH organization a request acted in was already correct
 * and did nothing about this: it changed the organization and left the permission set untouched.
 * These tests state the property that was missing.
 */
describe('Tenant-scoped authorisation', () => {
  const ORG_A = '11111111-1111-4111-8111-111111111111';
  const ORG_B = '22222222-2222-4222-8222-222222222222';

  const cachedUser = (): CachedUser => ({
    id: 'user-1',
    email: 'ana@example.com',
    firstName: 'Ana',
    lastName: 'Pérez',
    status: UserStatus.ACTIVE,
    organizationId: ORG_A,
    roleAssignments: [
      { name: 'Administrator', organizationId: ORG_A, permissions: ['users:delete', 'billing:manage'] },
      { name: 'Viewer', organizationId: ORG_B, permissions: ['invoices:read'] },
      { name: 'Platform Support', organizationId: null, permissions: ['support:read'] },
    ],
    tokenVersion: 0,
    isTwoFactorEnabled: false,
  });

  describe('UserIdentityService.permissionsFor', () => {
    it('grants only the rights held in the active tenant', () => {
      expect(UserIdentityService.permissionsFor(cachedUser(), ORG_A).sort()).toEqual([
        'billing:manage',
        'support:read',
        'users:delete',
      ]);
    });

    it('does NOT carry one tenant\'s administrator rights into another', () => {
      const inB = UserIdentityService.permissionsFor(cachedUser(), ORG_B);

      expect(inB).toContain('invoices:read');
      expect(inB).not.toContain('users:delete');
      expect(inB).not.toContain('billing:manage');
    });

    it('applies platform-level roles everywhere, by design', () => {
      // A role with a null organization_id is a support or operations role. Those are seeded, not
      // self-assignable, and are deliberately not tenant-scoped.
      expect(UserIdentityService.permissionsFor(cachedUser(), ORG_A)).toContain('support:read');
      expect(UserIdentityService.permissionsFor(cachedUser(), ORG_B)).toContain('support:read');
    });

    it('grants nothing but platform rights for a tenant the user holds no role in', () => {
      expect(UserIdentityService.permissionsFor(cachedUser(), 'unknown-org')).toEqual([
        'support:read',
      ]);
    });

    it('scopes role NAMES on the same rule as the permissions', () => {
      expect(UserIdentityService.roleNamesFor(cachedUser(), ORG_B).sort()).toEqual([
        'Platform Support',
        'Viewer',
      ]);
    });
  });

  describe('TokenService.buildSafeUser', () => {
    const entityUser = (): User =>
      ({
        id: 'user-1',
        email: 'ana@example.com',
        organizationId: ORG_A,
        roles: [
          { name: 'Administrator', organizationId: ORG_A, permissions: ['users:delete'] },
          { name: 'Viewer', organizationId: ORG_B, permissions: ['invoices:read'] },
        ],
        security: { isTwoFactorEnabled: false },
      }) as unknown as User;

    // Constructed directly: the method under test reads nothing from the instance.
    const service = Object.create(TokenService.prototype) as TokenService;

    it('returns the rights for the tenant the tokens are issued for', () => {
      expect(service.buildSafeUser(entityUser(), ORG_A).permissions).toEqual(['users:delete']);
      expect(service.buildSafeUser(entityUser(), ORG_B).permissions).toEqual(['invoices:read']);
    });

    it('defaults to the user\'s own tenant when none is given', () => {
      expect(service.buildSafeUser(entityUser()).permissions).toEqual(['users:delete']);
    });
  });

  describe('TokenService.buildPayload', () => {
    const service = Object.create(TokenService.prototype) as TokenService;
    const entityUser = (): User =>
      ({
        id: 'user-1',
        email: 'ana@example.com',
        organizationId: ORG_A,
        roles: [
          { name: 'Administrator', organizationId: ORG_A, permissions: [] },
          { name: 'Viewer', organizationId: ORG_B, permissions: [] },
        ],
        security: { tokenVersion: 3 },
      }) as unknown as User;

    it('stamps the tenant the token is for, and only that tenant\'s roles', () => {
      const payload = service.buildPayload(entityUser(), { organizationId: ORG_B });

      expect(payload.organizationId).toBe(ORG_B);
      expect(payload.roles).toEqual(['Viewer']);
      expect(payload.tokenVersion).toBe(3);
    });

    it('falls back to the user\'s own tenant', () => {
      const payload = service.buildPayload(entityUser());

      expect(payload.organizationId).toBe(ORG_A);
      expect(payload.roles).toEqual(['Administrator']);
    });
  });
});
