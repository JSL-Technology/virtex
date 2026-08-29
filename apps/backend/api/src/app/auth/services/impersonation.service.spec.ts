import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ImpersonationService } from './impersonation.service';
import { UserCacheService } from '../modules/user-cache.service';
import { User, UserStatus } from '../../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

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

  // Built as the request principal, which is what the service takes: `User` (the entity) is not
  // assignable to it, because the principal's `organizationId` is non-null by construction.
  const user = (over: Partial<User> & { permissions?: string[] } = {}): AuthenticatedUser => {
    const { permissions, ...rest } = over;
    return {
      id: 'target-id',
      email: 'target@example.com',
      organizationId: 'org-1',
      status: UserStatus.ACTIVE,
      roles: permissions ? [{ name: 'custom', permissions }] : [],
      ...rest,
    } as unknown as AuthenticatedUser;
  };

  const operator = (permissions: string[], over: Partial<User> = {}): AuthenticatedUser =>
    user({ id: 'admin-id', email: 'admin@example.com', permissions, ...over });

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
    userRepositoryMock.findOne.mockResolvedValue(user({ permissions: ['*'] }));

    await expect(
      service.validateImpersonationRequest(operator(['users:impersonate']), 'target-id'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a target holding any permission the operator lacks', async () => {
    userRepositoryMock.findOne.mockResolvedValue(user({ permissions: ['billing:manage'] }));

    await expect(
      service.validateImpersonationRequest(
        operator(['users:impersonate', 'users:view']),
        'target-id',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows impersonating a strictly less privileged target', async () => {
    userRepositoryMock.findOne.mockResolvedValue(user({ permissions: ['users:view'] }));

    await expect(
      service.validateImpersonationRequest(
        operator(['users:impersonate', 'users:view', 'billing:manage']),
        'target-id',
      ),
    ).resolves.toMatchObject({ id: 'target-id' });
  });

  it('honours prefix wildcards held by the operator', async () => {
    userRepositoryMock.findOne.mockResolvedValue(user({ permissions: ['users:delete'] }));

    await expect(
      service.validateImpersonationRequest(
        operator(['users:impersonate', 'users:*']),
        'target-id',
      ),
    ).resolves.toMatchObject({ id: 'target-id' });
  });

  it('lets a super-admin impersonate another super-admin', async () => {
    userRepositoryMock.findOne.mockResolvedValue(user({ permissions: ['*'] }));

    await expect(
      service.validateImpersonationRequest(operator(['*']), 'target-id'),
    ).resolves.toMatchObject({ id: 'target-id' });
  });

  it('never crosses an organization boundary', async () => {
    userRepositoryMock.findOne.mockResolvedValue(
      user({ organizationId: 'org-2', permissions: [] }),
    );

    // Reported as "not found" so the endpoint cannot be used to probe for user ids in
    // other tenants.
    await expect(
      service.validateImpersonationRequest(operator(['*']), 'target-id'),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses to impersonate a non-active account', async () => {
    userRepositoryMock.findOne.mockResolvedValue(
      user({ status: UserStatus.BLOCKED, permissions: [] }),
    );

    await expect(
      service.validateImpersonationRequest(operator(['*']), 'target-id'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses nested impersonation', async () => {
    const alreadyImpersonating = operator(['*'], { isImpersonating: true } as Partial<User>);

    await expect(
      service.validateImpersonationRequest(alreadyImpersonating, 'target-id'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses self-impersonation', async () => {
    await expect(
      service.validateImpersonationRequest(operator(['*']), 'admin-id'),
    ).rejects.toThrow(BadRequestException);
  });
});
