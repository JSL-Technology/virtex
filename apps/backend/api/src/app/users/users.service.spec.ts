
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

describe('UsersService', () => {
  let service: UsersService;
  let userRepositoryMock: any;
  let userCacheServiceMock: any;

  beforeEach(async () => {
    userRepositoryMock = {
      findOne: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        getOne: jest.fn()
      }))
    };

    userCacheServiceMock = {
      clearUserSession: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepositoryMock },
        { provide: getRepositoryToken(Organization), useValue: {} },
        { provide: UserCacheService, useValue: userCacheServiceMock },
        { provide: MailService, useValue: {} },
        { provide: RolesService, useValue: {} },
        { provide: EventsGateway, useValue: {} },
        { provide: EventEmitter2, useValue: {} },
        { provide: SaasService, useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: PasswordService, useValue: { hash: jest.fn(), verify: jest.fn() } },
        { provide: SessionService, useValue: { terminateAllSessions: jest.fn() } },
        // `user_organizations` is written by this service now, not just read by a raw query.
        { provide: MembershipService, useValue: { grant: jest.fn(), isMember: jest.fn().mockResolvedValue(false), listFor: jest.fn().mockResolvedValue([]) } }
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
      const updatedUser = await service.updateProfile('123', dto);

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

      const updatedUser = await service.updateProfile('123', dto);

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

      const updatedUser = await service.updateProfile('123', dto);

      expect(updatedUser.isEmailVerified).toBe(true);
      expect(updatedUser.isPhoneVerified).toBe(true);
      expect(updatedUser.firstName).toBe('NewName');
    });
  });
});
