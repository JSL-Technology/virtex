import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ImpersonationService } from './impersonation.service';
import { UserCacheService } from '../modules/user-cache.service';
import { User, UserStatus } from '../../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../../security/principal';

/**
 * C-4 regression suite.
 *
 * Seniority used to be scored from a hardcoded name->level map
 * (`ADMINISTRATOR: 100, ACCOUNTANT: 50, SELLER: 50, MEMBER: 10`) while the roles module lets each
 * organization invent arbitrary role names. Every custom role therefore scored 0, so the check
 * `targetLevel > adminLevel` compared `0 > 0` and passed — a full privilege escalation: an
 * operator holding only `users:impersonate` could assume the identity of a user whose custom role
 * carried `*`.
 *
 * The decision is now permission-subset based, which is invariant to naming.
 */
describe('ImpersonationService — privilege escalation guards', () => {
  let service: ImpersonationService;
  let userRepositoryMock: { findOne: jest.Mock };

  /**
   * The request principal, built the way production builds it.
   *
   * This is the half of the suite that was wrong, and it was wrong in the direction that hides a
   * defect rather than invents one. The fixture used to put the operator's permissions in
   * `roles: [{ name: 'custom', permissions }]`, because that is where the service looked for
   * them. `UserIdentityService.buildPrincipal` does not produce that shape and never has:
   *
   *     roles:       roleNamesFor(user, orgId).map((name) => ({ name })),   // names, no permissions
   *     permissions: permissionsFor(user, orgId),                           // <- the real set
   *
   * So every assertion below passed against a principal the server cannot emit, while the real
   * one made `hasPermission([], ['users:impersonate'])` false and 403'd every impersonation in
   * production. Mirroring `buildPrincipal` here is what makes these tests able to fail.
   *
   * `roles` is deliberately populated with NAME-ONLY objects, so that a future regression which
   * goes back to reading `roles[].permissions` reads an empty set and the suite goes red.
   */
  const principal = (permissions: string[], over: Record<string, unknown> = {}): AuthenticatedUser =>
    ({
      id: 'admin-id',
      email: 'admin@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      organizationId: 'org-1',
      roles: [{ name: 'custom' }],
      permissions,
      ...over,
    }) as unknown as AuthenticatedUser;

  /**
   * The TARGET, which really is a `User` entity loaded with `relations: ['roles']` — so here the
   * permissions genuinely do hang off the roles, and `permissionsOfEntity` is right to read them
   * there. Two different shapes for two different things, which is the distinction the single
   * old helper collapsed.
   */
  const target = (over: Partial<User> & { permissions?: string[] } = {}): User => {
    const { permissions, ...rest } = over;
    return {
      id: 'target-id',
      email: 'target@example.com',
      organizationId: 'org-1',
      status: UserStatus.ACTIVE,
      roles: permissions ? [{ name: 'custom', permissions }] : [],
      ...rest,
    } as unknown as User;
  };

  const operator = (permissions: string[], over: Record<string, unknown> = {}): AuthenticatedUser =>
    principal(permissions, over);

  beforeEach(async () => {
    userRepositoryMock = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImpersonationService,
        { provide: getRepositoryToken(User), useValue: userRepositoryMock },
        { provide: UserCacheService, useValue: { clearUserSession: jest.fn() } },
      ],
    }).compile();

    service = module.get(ImpersonationService);
  });

  it('refuses an operator without users:impersonate', async () => {
    await expect(
      service.validateImpersonationRequest(operator(['users:view']), 'target-id'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('THE C-4 CASE: refuses to impersonate a custom role holding the wildcard', async () => {
    // Both sides carry custom role names, so the old name-based hierarchy scored both 0 and
    // allowed this — handing the operator full super-admin access.
    userRepositoryMock.findOne.mockResolvedValue(target({ permissions: ['*'] }));

    await expect(
      service.validateImpersonationRequest(operator(['users:impersonate']), 'target-id'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a target holding any permission the operator lacks', async () => {
    userRepositoryMock.findOne.mockResolvedValue(target({ permissions: ['billing:manage'] }));

    await expect(
      service.validateImpersonationRequest(
        operator(['users:impersonate', 'users:view']),
        'target-id',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows impersonating a strictly less privileged target', async () => {
    userRepositoryMock.findOne.mockResolvedValue(target({ permissions: ['users:view'] }));

    await expect(
      service.validateImpersonationRequest(
        operator(['users:impersonate', 'users:view', 'billing:manage']),
        'target-id',
      ),
    ).resolves.toMatchObject({ id: 'target-id' });
  });

  it('honours prefix wildcards held by the operator', async () => {
    userRepositoryMock.findOne.mockResolvedValue(target({ permissions: ['users:delete'] }));

    await expect(
      service.validateImpersonationRequest(
        operator(['users:impersonate', 'users:*']),
        'target-id',
      ),
    ).resolves.toMatchObject({ id: 'target-id' });
  });

  it('lets a super-admin impersonate another super-admin', async () => {
    userRepositoryMock.findOne.mockResolvedValue(target({ permissions: ['*'] }));

    await expect(
      service.validateImpersonationRequest(operator(['*']), 'target-id'),
    ).resolves.toMatchObject({ id: 'target-id' });
  });

  it('never crosses an organization boundary', async () => {
    userRepositoryMock.findOne.mockResolvedValue(
      target({ organizationId: 'org-2', permissions: [] }),
    );

    // Reported as "not found" so the endpoint cannot be used to probe for user ids in
    // other tenants.
    await expect(
      service.validateImpersonationRequest(operator(['*']), 'target-id'),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses to impersonate a non-active account', async () => {
    userRepositoryMock.findOne.mockResolvedValue(
      target({ status: UserStatus.BLOCKED, permissions: [] }),
    );

    await expect(
      service.validateImpersonationRequest(operator(['*']), 'target-id'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses nested impersonation', async () => {
    const alreadyImpersonating = operator(['*'], { isImpersonating: true });

    await expect(
      service.validateImpersonationRequest(alreadyImpersonating, 'target-id'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses self-impersonation', async () => {
    await expect(
      service.validateImpersonationRequest(operator(['*']), 'admin-id'),
    ).rejects.toThrow(BadRequestException);
  });

  /**
   * The regression that the old fixture could not express.
   *
   * A principal shaped exactly as `UserIdentityService.buildPrincipal` emits one: permissions in
   * `permissions`, and `roles` carrying names and nothing else. If the service ever goes back to
   * reading `roles[].permissions`, the operator's set resolves to `[]`, `users:impersonate` is
   * absent, and this test fails — which is precisely what production was doing silently while the
   * suite was green.
   */
  it('reads the operator permissions from principal.permissions, not from principal.roles', async () => {
    const productionShaped = {
      id: 'admin-id',
      email: 'admin@example.com',
      organizationId: 'org-1',
      // Name-only, as the real principal builder produces.
      roles: [{ name: 'Administrador' }],
      permissions: ['users:impersonate', 'users:view'],
    } as unknown as AuthenticatedUser;

    userRepositoryMock.findOne.mockResolvedValue(target({ permissions: ['users:view'] }));

    await expect(
      service.validateImpersonationRequest(productionShaped, 'target-id'),
    ).resolves.toMatchObject({ id: 'target-id' });
  });

  /**
   * And the other half of the same contract: the anti-escalation check must still bite when the
   * operator's real set does not cover the target's. Reading the empty `roles[].permissions`
   * would make this pass for the wrong reason, so it is asserted next to the case above.
   */
  it('still refuses escalation when the operator set comes from principal.permissions', async () => {
    const productionShaped = {
      id: 'admin-id',
      email: 'admin@example.com',
      organizationId: 'org-1',
      roles: [{ name: 'Administrador' }],
      permissions: ['users:impersonate'],
    } as unknown as AuthenticatedUser;

    userRepositoryMock.findOne.mockResolvedValue(target({ permissions: ['payroll:approve'] }));

    await expect(
      service.validateImpersonationRequest(productionShaped, 'target-id'),
    ).rejects.toThrow(ForbiddenException);
  });
});
