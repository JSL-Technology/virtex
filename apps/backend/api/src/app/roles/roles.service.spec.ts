import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RolesService } from './roles.service';
import { Role } from './entities/role.entity';
import { User } from '../users/entities/user.entity/user.entity';
import { UserCacheService } from '../auth/modules/user-cache.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

/**
 * Fase 2.4: authorization tests for the role authority graph. These cover the privilege-escalation
 * guards (H-01 / H8) and the H2 fix that forbids deleting a role still assigned to users. They run
 * against mocked repositories so they are fast and deterministic (no DB required).
 */
describe('RolesService — authorization', () => {
  let service: RolesService;
  let roleRepositoryMock: any;
  let userCacheServiceMock: any;

  // Transactional entity manager used inside remove()'s transaction.
  let userQueryBuilderMock: any;
  let roleRepoInTxMock: any;

  const actor = (permissions: string[]): AuthenticatedUser =>
    ({ id: 'actor-id', permissions } as unknown as AuthenticatedUser);

  const role = (permissions: string[], extra: Partial<Role> = {}): Role =>
    ({ id: 'role-id', name: 'Role', permissions, isSystemRole: false, organizationId: 'org-1', ...extra } as Role);

  beforeEach(async () => {
    userQueryBuilderMock = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    };
    roleRepoInTxMock = { remove: jest.fn().mockResolvedValue(undefined) };

    const transactionalManager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === User) {
          return { createQueryBuilder: jest.fn(() => userQueryBuilderMock) };
        }
        return roleRepoInTxMock; // Role
      }),
    };

    roleRepositoryMock = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve(x)),
      manager: {
        transaction: jest.fn(async (cb: any) => cb(transactionalManager)),
      },
    };

    userCacheServiceMock = { clearUserSession: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: getRepositoryToken(Role), useValue: roleRepositoryMock },
        { provide: UserCacheService, useValue: userCacheServiceMock },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
  });

  describe('assertCanAssignRole', () => {
    it('blocks a non-super-admin from assigning a wildcard (*) role — vertical escalation', () => {
      expect(() => service.assertCanAssignRole(actor(['users:edit']), role(['*']))).toThrow(
        ForbiddenException,
      );
    });

    it('allows a super-admin to assign a wildcard (*) role', () => {
      expect(() => service.assertCanAssignRole(actor(['*']), role(['*']))).not.toThrow();
    });

    it('allows a super-admin to assign any non-wildcard role', () => {
      expect(() =>
        service.assertCanAssignRole(actor(['*']), role(['users:delete', 'roles:edit'])),
      ).not.toThrow();
    });

    it('blocks assigning a role containing a permission the actor does not hold', () => {
      expect(() =>
        service.assertCanAssignRole(actor(['users:view']), role(['users:delete'])),
      ).toThrow(ForbiddenException);
    });

    it('allows assigning a role whose permissions the actor already holds', () => {
      expect(() =>
        service.assertCanAssignRole(actor(['users:view', 'users:edit']), role(['users:view'])),
      ).not.toThrow();
    });

    it('honors prefix wildcards held by the actor (e.g. users:*)', () => {
      expect(() =>
        service.assertCanAssignRole(actor(['users:*']), role(['users:delete'])),
      ).not.toThrow();
    });
  });

  describe('create (assertAssignablePermissions)', () => {
    // The escalation guard runs synchronously before create() returns its save() promise,
    // so these throw synchronously rather than rejecting.
    it('refuses to delegate the wildcard (*) permission to a new role', () => {
      expect(() =>
        service.create({ name: 'X', permissions: ['*'] } as any, 'org-1', actor(['*'])),
      ).toThrow(ForbiddenException);
    });

    it('refuses to grant a permission the creator does not hold', () => {
      expect(() =>
        service.create({ name: 'X', permissions: ['users:delete'] } as any, 'org-1', actor(['users:view'])),
      ).toThrow(ForbiddenException);
    });

    it('creates the role when the creator holds every requested permission', async () => {
      await expect(
        service.create({ name: 'X', permissions: ['users:view'] } as any, 'org-1', actor(['users:view'])),
      ).resolves.toBeDefined();
      expect(roleRepositoryMock.save).toHaveBeenCalled();
    });
  });

  describe('remove (H2)', () => {
    it('refuses to delete a system role', async () => {
      roleRepositoryMock.findOne.mockResolvedValue(role([], { isSystemRole: true }));
      await expect(service.remove('role-id', 'org-1')).rejects.toThrow(ForbiddenException);
      expect(roleRepositoryMock.manager.transaction).not.toHaveBeenCalled();
    });

    it('refuses to delete a role still assigned to users', async () => {
      roleRepositoryMock.findOne.mockResolvedValue(role(['users:view']));
      userQueryBuilderMock.getCount.mockResolvedValue(3);

      await expect(service.remove('role-id', 'org-1')).rejects.toThrow(ForbiddenException);
      expect(roleRepoInTxMock.remove).not.toHaveBeenCalled();
    });

    it('deletes a non-system role with no assigned users', async () => {
      const target = role(['users:view']);
      roleRepositoryMock.findOne.mockResolvedValue(target);
      userQueryBuilderMock.getCount.mockResolvedValue(0);

      await service.remove('role-id', 'org-1');
      expect(roleRepoInTxMock.remove).toHaveBeenCalledWith(target);
    });
  });
});
