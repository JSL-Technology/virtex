
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from './entities/user.entity/user.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { UserCacheService } from '../auth/modules/user-cache.service';
import { PasswordVerifierPort } from '../auth/ports/password-verifier.port';
import { SessionInvalidatorPort } from '../auth/ports/session-invalidator.port';
import { MailService } from '../mail/mail.service';
import { RolesService } from '../roles/roles.service';
import { EventsGateway } from '../websockets/events.gateway';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SaasService } from '../saas/saas.service';
import { DataSource } from 'typeorm';
import { PasswordService } from '../auth/services/password.service';
import { SessionService } from '../auth/services/session.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { MembershipService } from '../organizations/services/membership.service';
import { AuditTrailService } from '../audit/audit.service';
import { ForbiddenException } from '@nestjs/common';
import { expectLocalizedError } from '../i18n/testing/expect-localized-error';
import { OrganizationInvitationsService } from './invitations/organization-invitations.service';
import { UserStatus } from './entities/user.entity/user.entity';
import * as identityWrites from './persistence/identity-writes';

describe('UsersService', () => {
  let service: UsersService;
  let userRepositoryMock: any;
  let userCacheServiceMock: any;
  let rolesServiceMock: any;
  let managerMock: any;
  let membershipMock: any;
  let invitationsMock: any;
  let sessionInvalidatorMock: any;
  let mailMock: any;

  beforeEach(async () => {
    rolesServiceMock = {
      findOne: jest.fn(),
      assertCanAssignRole: jest.fn(),
    };

    // `findOne` resolves roles for one tenant, so it goes through a query builder now. The
    // double answers from the same `findOne` mock the tests already set up, which keeps them
    // readable and still exercises the real scoping argument.
    // Identity writes go through the repository's MANAGER (`saveIdentity`), never `repo.save`:
    // the double records exactly what reached it, roles included or not.
    managerMock = {
      save: jest.fn((_entity: unknown, value: unknown) => Promise.resolve(value)),
      query: jest.fn().mockResolvedValue([]),
    };
    userRepositoryMock = {
      manager: managerMock,
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        getOne: jest.fn(() => userRepositoryMock.findOne()),
      })),
    };

    userCacheServiceMock = {
      clearUserSession: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepositoryMock },
        // `findOne` resolves the ACTIVE organization now, not the user's home one.
        { provide: getRepositoryToken(Organization), useValue: { findOneBy: jest.fn().mockResolvedValue(null) } },
        { provide: UserCacheService, useValue: userCacheServiceMock },
        // `PasswordVerifierPort` se introdujo para que Identidad no dependiera de Auth por dentro
        // (B-02). El módulo de prueba no lo declaró, así que este archivo no resolvía sus
        // dependencias y sus siete pruebas no se han ejecutado desde entonces.
        { provide: PasswordVerifierPort, useValue: { verify: jest.fn().mockResolvedValue(true) } },
        { provide: MailService, useValue: (mailMock = { sendEmailChangedNotice: jest.fn(), sendUserInvitation: jest.fn() }) },
        { provide: RolesService, useValue: rolesServiceMock },
        { provide: EventsGateway, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: SaasService, useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: PasswordService, useValue: { hash: jest.fn(), verify: jest.fn() } },
        // El PUERTO, no el servicio concreto: `SessionInvalidatorPort` se introdujo junto con
        // `PasswordVerifierPort` para que Identidad no dependiera de Auth por dentro (B-02).
        { provide: SessionInvalidatorPort, useValue: (sessionInvalidatorMock = { terminateAllSessions: jest.fn() }) },
        { provide: SessionService, useValue: { terminateAllSessions: jest.fn() } },
        // `user_organizations` is written by this service now, not just read by a raw query.
        { provide: MembershipService, useValue: (membershipMock = { grant: jest.fn(), revoke: jest.fn(), suspend: jest.fn(), reinstate: jest.fn(), isMember: jest.fn().mockResolvedValue(false), hasMembershipRow: jest.fn().mockResolvedValue(false), listFor: jest.fn().mockResolvedValue([]) }) },
        { provide: OrganizationInvitationsService, useValue: (invitationsMock = { invite: jest.fn().mockResolvedValue({ id: 'inv-1' }) }) },
        // The activity log is served from the audit trail now; it used to return a hardcoded [].
        { provide: AuditTrailService, useValue: { findByActor: jest.fn().mockResolvedValue([]), record: jest.fn() } }
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('updateProfile', () => {
    it('does NOT change the email — that requires the confirmation flow', async () => {
      // updateProfile deliberately cannot change the email address. `email` was removed from
      // UpdateProfileDto and the global ValidationPipe (whitelist: true) strips it, so a client
      // that submits one is ignored rather than obeyed. Changing an email is a two-step,
      // token-confirmed operation (requestEmailChange + confirmEmailChange) precisely because a
      // silent change would let a hijacked session lock the real owner out of their account.
      const existingUser = {
        id: '123',
        email: 'old@example.com',
        isEmailVerified: true,
        isPhoneVerified: true,
        phone: '123',
      };
      userRepositoryMock.findOne.mockResolvedValue(existingUser);
      userRepositoryMock.save.mockImplementation((u: any) => Promise.resolve(u));

      const dto = { email: 'new@example.com' } as unknown as UpdateProfileDto;
      const updatedUser = await service.updateProfile('123', dto, 'org-1');

      expect(updatedUser.email).toBe('old@example.com');
      expect(updatedUser.isEmailVerified).toBe(true);
    });

    it('should reset isPhoneVerified if phone changes', async () => {
      const user = new User();
      user.id = '123';
      user.phone = '1234567890';
      user.isPhoneVerified = true;

      userRepositoryMock.findOne.mockResolvedValue(user);
      userRepositoryMock.save.mockImplementation((u: User) => Promise.resolve(u));

      const dto: UpdateProfileDto = { phone: '0987654321' };

      const updatedUser = await service.updateProfile('123', dto, 'org-1');

      expect(updatedUser.isPhoneVerified).toBe(false);
      expect(updatedUser.phone).toBe('0987654321');
    });

    it('should NOT reset flags if data is same', async () => {
      const user = new User();
      user.id = '123';
      user.email = 'same@example.com';
      user.isEmailVerified = true;
      user.phone = '111111';
      user.isPhoneVerified = true;

      userRepositoryMock.findOne.mockResolvedValue(user);
      userRepositoryMock.save.mockImplementation((u: User) => Promise.resolve(u));

      // `email` is deliberately NOT part of UpdateProfileDto — changing it goes through the
      // confirmation flow — and this test asserts that sending it anyway is ignored.
      const dto = {
        email: 'same@example.com',
        phone: '111111',
        firstName: 'NewName',
      } as UpdateProfileDto & { email: string };

      const updatedUser = await service.updateProfile('123', dto, 'org-1');

      expect(updatedUser.isEmailVerified).toBe(true);
      expect(updatedUser.isPhoneVerified).toBe(true);
      expect(updatedUser.firstName).toBe('NewName');
    });
  });

  /**
   * An invitation grants a role, so it is a privilege delegation. `updateUser` had guarded that
   * since the H-01 fix; `inviteUser` never did, which meant an operator holding only
   * `users:create` could invite an address they control as ADMINISTRATOR ('*') and own the
   * tenant. These tests exist so that hole cannot silently reopen.
   */
  describe('inviteUser', () => {
    const invite = { email: 'new@example.com', firstName: 'A', lastName: 'B', roleId: 'role-1' };
    const actor = { id: 'actor-1', permissions: ['users:create'] } as never;

    it('refuses to delegate a role the actor does not hold', async () => {
      const adminRole = { id: 'role-1', name: 'ADMINISTRATOR', permissions: ['*'] };
      rolesServiceMock.findOne.mockResolvedValue(adminRole);
      rolesServiceMock.assertCanAssignRole.mockImplementation(() => {
        throw new ForbiddenException('No puedes asignar un rol con privilegios totales (*).');
      });

      await expect(service.inviteUser(invite as never, 'org-1', actor)).rejects.toThrow(
        ForbiddenException,
      );

      expect(rolesServiceMock.assertCanAssignRole).toHaveBeenCalledWith(actor, adminRole);
      // The check has to happen BEFORE anything is written or emailed.
      expect(userRepositoryMock.findOne).not.toHaveBeenCalled();
    });

    it('checks the role before branching on whether the person already has an account', async () => {
      // The existing-account path assigns a role too; both branches must be covered by one check.
      rolesServiceMock.findOne.mockResolvedValue({ id: 'role-1', permissions: ['invoices:read'] });
      rolesServiceMock.assertCanAssignRole.mockImplementation(() => {
        throw new ForbiddenException('nope');
      });
      userRepositoryMock.findOne.mockResolvedValue({ id: 'existing-user' });

      await expect(service.inviteUser(invite as never, 'org-1', actor)).rejects.toThrow(
        ForbiddenException,
      );
      expect(userRepositoryMock.findOne).not.toHaveBeenCalled();
    });

    it('rejects an unknown role without revealing that it is the role that is wrong', async () => {
      rolesServiceMock.findOne.mockResolvedValue(null);

      await expectLocalizedError(
        service.inviteUser(invite as never, 'org-1', actor),
        'users.invitation_could_not_sent_with_details',
      );
      expect(rolesServiceMock.assertCanAssignRole).not.toHaveBeenCalled();
    });
  });

  /**
   * S-2: a `save` of a user whose roles were loaded for ONE tenant made TypeORM delete the
   * person's roles in every OTHER tenant. Identity writes must never carry the role relation.
   */
  describe('identity writes never carry the role graph', () => {
    it('updateProfile persists the user WITHOUT its roles, and hands them back intact', async () => {
      const roleInB = { id: 'role-b', organizationId: 'org-b', permissions: ['x:read'] };
      const user = Object.assign(new User(), { id: 'u1', phone: '1', roles: [roleInB] });
      userRepositoryMock.findOne.mockResolvedValue(user);

      let rolesAtSave: unknown = 'not-called';
      managerMock.save.mockImplementation((_e: unknown, value: { roles?: unknown }) => {
        rolesAtSave = Object.prototype.hasOwnProperty.call(value, 'roles') ? value.roles : undefined;
        return Promise.resolve(value);
      });

      const result = await service.updateProfile('u1', { firstName: 'Z' }, 'org-b');

      expect(rolesAtSave).toBeUndefined();
      expect(result.roles).toEqual([roleInB]);
      expect(userRepositoryMock.save).not.toHaveBeenCalled();
    });

    it('updateUser changes a role through the scoped writer, not through save', async () => {
      const spy = jest.spyOn(identityWrites, 'replaceRolesInOrganization').mockResolvedValue();
      const member = Object.assign(new User(), { id: 'u2', organizationId: 'org-a', roles: [] });
      userRepositoryMock.findOne.mockResolvedValue(member);
      rolesServiceMock.findOne.mockResolvedValue({ id: 'role-b', organizationId: 'org-b', permissions: ['x:read'] });

      await service.updateUser('u2', { roleId: 'role-b' }, 'org-b', { id: 'admin' } as never);

      expect(spy).toHaveBeenCalledWith(managerMock, 'u2', 'org-b', ['role-b']);
      expect(managerMock.save).not.toHaveBeenCalled();
      expect(userRepositoryMock.save).not.toHaveBeenCalled();
      // A role change here must not sign the person out of every other tenant.
      expect(sessionInvalidatorMock.terminateAllSessions).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  /**
   * S-1: an identity is shared by every tenant its person works for. Only the HOME organization
   * may change what they all share; any other tenant administers its membership and its role.
   */
  describe('identity authority belongs to the home organization', () => {
    const guest = () =>
      Object.assign(new User(), {
        id: 'victim',
        email: 'victim@a.test',
        organizationId: 'org-a',
        status: UserStatus.ACTIVE,
        roles: [],
        security: { tokenVersion: 0 },
      });

    it('refuses to change the email of a member homed in another organization', async () => {
      userRepositoryMock.findOne.mockResolvedValue(guest());
      await expectLocalizedError(
        service.adminChangeEmail('victim', 'attacker@evil.test', 'org-b'),
        'users.identity_managed_by_home_organization',
      );
      expect(managerMock.save).not.toHaveBeenCalled();
    });

    it('refuses a password reset for a member homed in another organization', async () => {
      userRepositoryMock.findOne.mockResolvedValue(guest());
      await expectLocalizedError(
        service.resetPassword('victim', 'org-b'),
        'users.identity_managed_by_home_organization',
      );
      expect(managerMock.save).not.toHaveBeenCalled();
    });

    it('refuses to end the global sessions of a member homed in another organization', async () => {
      userRepositoryMock.findOne.mockResolvedValue(guest());
      await expectLocalizedError(
        service.forceLogout('victim', 'org-b'),
        'users.identity_managed_by_home_organization',
      );
      expect(sessionInvalidatorMock.terminateAllSessions).not.toHaveBeenCalled();
    });

    it('refuses to rename a member homed in another organization', async () => {
      userRepositoryMock.findOne.mockResolvedValue(guest());
      await expectLocalizedError(
        service.updateUser('victim', { firstName: 'X' }, 'org-b', { id: 'admin' } as never),
        'users.identity_managed_by_home_organization',
      );
    });

    it('blocking a guest member suspends THIS membership and leaves the account alone', async () => {
      const user = guest();
      userRepositoryMock.findOne.mockResolvedValue(user);

      await service.updateUserStatus('victim', UserStatus.BLOCKED, 'org-b', 'admin');

      expect(membershipMock.suspend).toHaveBeenCalledWith('victim', 'org-b');
      expect(managerMock.save).not.toHaveBeenCalled();
      expect(sessionInvalidatorMock.terminateAllSessions).not.toHaveBeenCalled();
    });

    it('block-and-logout of a guest member suspends the membership only', async () => {
      userRepositoryMock.findOne.mockResolvedValue(guest());
      const result = await service.blockAndLogout('victim', 'org-b');
      expect(result).toEqual({ messageKey: 'users.membership_suspended' });
      expect(membershipMock.suspend).toHaveBeenCalledWith('victim', 'org-b');
      expect(managerMock.save).not.toHaveBeenCalled();
    });

    it('the home organization blocks the account and really ends every session', async () => {
      const user = Object.assign(guest(), { organizationId: 'org-b' });
      userRepositoryMock.findOne.mockResolvedValue(user);

      await service.updateUserStatus('victim', UserStatus.BLOCKED, 'org-b', 'admin');

      expect(user.status).toBe(UserStatus.BLOCKED);
      expect(sessionInvalidatorMock.terminateAllSessions).toHaveBeenCalledWith('victim');
    });

    it('the home organization changes the email, ends the sessions and tells the old address', async () => {
      const user = Object.assign(guest(), { organizationId: 'org-b' });
      // The member lookup (query builder) and the uniqueness lookup share this mock: the
      // uniqueness lookup — the one that filters by email — answers "nobody has it".
      userRepositoryMock.findOne.mockImplementation((options?: { where?: { email?: string } }) =>
        Promise.resolve(options?.where?.email ? null : user),
      );

      await service.adminChangeEmail('victim', 'New@B.test', 'org-b');

      expect(user.email).toBe('new@b.test');
      expect(sessionInvalidatorMock.terminateAllSessions).toHaveBeenCalledWith('victim');
      expect(mailMock.sendEmailChangedNotice).toHaveBeenCalledWith('victim@a.test', undefined, 'new@b.test');
    });
  });

  describe('inviting an existing account is a request, not a grant', () => {
    const dto = { email: 'victim@a.test', firstName: 'Given', lastName: 'ByInviter', roleId: 'role-b' };
    const role = { id: 'role-b', name: 'Viewer', organizationId: 'org-b', permissions: ['x:read'] };

    it('records an invitation, writes no membership, and answers only with what the inviter sent', async () => {
      rolesServiceMock.findOne.mockResolvedValue(role);
      userRepositoryMock.findOne.mockResolvedValue({
        id: 'victim',
        email: 'victim@a.test',
        firstName: 'Real',
        phone: '+18095550000',
        organizationId: 'org-a',
        roles: [{ id: 'admin-a', organizationId: 'org-a', permissions: ['*'] }],
      });
      const actor = { id: 'admin-b', permissions: ['*'] } as never;

      const receipt = await service.inviteUser(dto as never, 'org-b', actor);

      expect(invitationsMock.invite).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'victim' }),
        'org-b',
        role,
        actor,
      );
      expect(membershipMock.grant).not.toHaveBeenCalled();
      expect(receipt).toMatchObject({
        id: 'inv-1',
        email: 'victim@a.test',
        firstName: 'Given',
        lastName: 'ByInviter',
        status: UserStatus.PENDING,
        organizationId: 'org-b',
        roles: [role],
      });
      expect(JSON.stringify(receipt)).not.toContain('+18095550000');
      expect(JSON.stringify(receipt)).not.toContain('admin-a');
    });
  });

  describe('inviting somebody already in this organization (QA B-02)', () => {
    const dto = { email: 'ana@a.test', firstName: 'Ana', lastName: 'Pérez', roleId: 'role-a' };
    const role = { id: 'role-a', name: 'Viewer', organizationId: 'org-a', permissions: ['x:read'] };
    const actor = { id: 'admin-a', permissions: ['*'] } as never;

    beforeEach(() => {
      rolesServiceMock.findOne.mockResolvedValue(role);
      membershipMock.hasMembershipRow.mockResolvedValue(true);
    });

    it('says the invitation is already pending, instead of a 201 that sends nothing', async () => {
      userRepositoryMock.findOne.mockResolvedValue({ id: 'u-1', email: dto.email, status: UserStatus.PENDING, organizationId: 'org-a' });
      await expect(service.inviteUser(dto as never, 'org-a', actor)).rejects.toMatchObject({
        messageKey: 'users.invitation_already_pending',
      });
      expect(invitationsMock.invite).not.toHaveBeenCalled();
    });

    it('says the person is already a member', async () => {
      userRepositoryMock.findOne.mockResolvedValue({ id: 'u-1', email: dto.email, status: UserStatus.ACTIVE, organizationId: 'org-z' });
      await expect(service.inviteUser(dto as never, 'org-a', actor)).rejects.toMatchObject({ messageKey: 'users.already_member' });
    });
  });

  describe('resending an invitation', () => {
    const actor = { id: 'admin-a', permissions: ['*'] } as never;

    it('rotates the link and sends it again to a pending member', async () => {
      userRepositoryMock.findOne.mockResolvedValue({ id: 'u-1', email: 'ana@a.test', status: UserStatus.PENDING, roles: [{ id: 'r' }] });
      userRepositoryMock.update.mockResolvedValue({ affected: 1 });

      const result = await service.resendInvitation('u-1', 'org-a', actor);

      expect(rolesServiceMock.assertCanAssignRole).toHaveBeenCalledWith(actor, { id: 'r' });
      const [where, patch] = userRepositoryMock.update.mock.calls[0];
      expect(where).toEqual({ id: 'u-1', organizationId: 'org-a', status: UserStatus.PENDING });
      expect(patch.invitationToken).toMatch(/^[0-9a-f]{64}$/);
      const [, rawToken] = mailMock.sendUserInvitation.mock.calls[0];
      expect(rawToken).not.toBe(patch.invitationToken);
      expect(result.email).toBe('ana@a.test');
    });

    it('refuses for an account that is already active', async () => {
      userRepositoryMock.findOne.mockResolvedValue({ id: 'u-1', email: 'ana@a.test', status: UserStatus.ACTIVE, roles: [] });
      await expect(service.resendInvitation('u-1', 'org-a', actor)).rejects.toMatchObject({ messageKey: 'users.invitation_not_pending' });
      expect(mailMock.sendUserInvitation).not.toHaveBeenCalled();
    });
  });
});
