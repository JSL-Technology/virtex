
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from './entities/user.entity/user.entity';
import { UserCacheService } from '../auth/modules/user-cache.service';
import { MailService } from '../mail/mail.service';
import { RolesService } from '../roles/roles.service';
import { EventsGateway } from '../websockets/events.gateway';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SaasService } from '../saas/saas.service';
import { DataSource } from 'typeorm';
import { UpdateProfileDto } from './dto/update-profile.dto';

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
        { provide: UserCacheService, useValue: userCacheServiceMock },
        { provide: MailService, useValue: {} },
        { provide: RolesService, useValue: {} },
        { provide: EventsGateway, useValue: {} },
        { provide: EventEmitter2, useValue: {} },
        { provide: SaasService, useValue: {} },
        { provide: DataSource, useValue: {} }
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('updateProfile', () => {
    it('should reset isEmailVerified if email changes', async () => {
      const user = new User();
      user.id = '123';
      user.email = 'old@example.com';
      user.isEmailVerified = true;

      userRepositoryMock.findOne.mockResolvedValue(user);
      userRepositoryMock.save.mockImplementation((u: User) => Promise.resolve(u));

      const dto: UpdateProfileDto = { email: 'new@example.com' };

      const updatedUser = await service.updateProfile('123', dto);

      expect(updatedUser.isEmailVerified).toBe(false);
      expect(updatedUser.email).toBe('new@example.com');
      expect(userCacheServiceMock.clearUserSession).toHaveBeenCalledWith('123');
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

      const dto: UpdateProfileDto = { email: 'same@example.com', phone: '111111', firstName: 'NewName' };

      const updatedUser = await service.updateProfile('123', dto);

      expect(updatedUser.isEmailVerified).toBe(true);
      expect(updatedUser.isPhoneVerified).toBe(true);
      expect(updatedUser.firstName).toBe('NewName');
    });
  });
});
