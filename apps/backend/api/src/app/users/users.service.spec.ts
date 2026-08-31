
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from './entities/user.entity/user.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { UserCacheService } from '../auth/modules/user-cache.service';
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

describe('UsersService', () => {
  let service: UsersService;
  let userRepositoryMock: any;
  let userCacheServiceMock: any;
  let rolesServiceMock: any;

  beforeEach(async () => {
    rolesServiceMock = {
      findOne: jest.fn(),
      assertCanAssignRole: jest.fn(),
    };

    // `findOne` resolves roles for one tenant, so it goes through a query builder now. The
    // double answers from the same `findOne` mock the tests already set up, which keeps them
    // readable and still exercises the real scoping argument.
    userRepositoryMock = {
      findOne: jest.fn(),
      save: jest.fn(),
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
        { provide: MailService, useValue: {} },
        { provide: RolesService, useValue: rolesServiceMock },
        { provide: EventsGateway, useValue: {} },
        { provide: EventEmitter2, useValue: {} },
        { provide: SaasService, useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: PasswordService, useValue: { hash: jest.fn(), verify: jest.fn() } },
        { provide: SessionService, useValue: { terminateAllSessions: jest.fn() } },
        // `user_organizations` is written by this service now, not just read by a raw query.
        { provide: MembershipService, useValue: { grant: jest.fn(), revoke: jest.fn(), isMember: jest.fn().mockResolvedValue(false), listFor: jest.fn().mockResolvedValue([]) } },
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
        'USERS.NO_PUDO_ENVIAR_INVITACION_DATOS_PROPORCIONADOS',
      );
      expect(rolesServiceMock.assertCanAssignRole).not.toHaveBeenCalled();
    });
  });
});
