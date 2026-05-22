import { Test, TestingModule } from '@nestjs/testing';
import { AccountSegmentsService } from './account-segments.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AccountSegmentDefinition } from './entities/account-segment-definition.entity';
import { Account } from './entities/account.entity';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';

describe('AccountSegmentsService', () => {
  let service: AccountSegmentsService;
  let segmentRepo: any;
  let accountRepo: any;
  let dataSource: any;

  beforeEach(async () => {
    segmentRepo = {
      find: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(d => d),
      save: jest.fn(d => Promise.resolve(d)),
    };
    accountRepo = {
      count: jest.fn(),
    };
    dataSource = {
      transaction: jest.fn(cb => cb({
        getRepository: (token: any) => {
          if (token === AccountSegmentDefinition) return segmentRepo;
          if (token === Account) return accountRepo;
          return null;
        }
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountSegmentsService,
        {
          provide: getRepositoryToken(AccountSegmentDefinition),
          useValue: segmentRepo,
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
      ],
    }).compile();

    service = module.get<AccountSegmentsService>(AccountSegmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('initializeDefault', () => {
    it('should initialize defaults if none exist', async () => {
      segmentRepo.find.mockResolvedValue([]);
      const orgId = 'org-1';

      const result = await service.initializeDefault(orgId);

      expect(segmentRepo.find).toHaveBeenCalledWith({ where: { organizationId: orgId } });
      expect(segmentRepo.save).toHaveBeenCalled();
      expect(result).toHaveLength(4);
    });

    it('should not initialize if segments already exist', async () => {
      segmentRepo.find.mockResolvedValue([{ id: '1' }]);
      const orgId = 'org-1';

      const result = await service.initializeDefault(orgId);

      expect(segmentRepo.save).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });
  });

  describe('configure', () => {
    it('should throw if accounts already exist', async () => {
      accountRepo.count.mockResolvedValue(5);
      const orgId = 'org-1';
      const dto = { segments: [{ name: 'N1', length: 1, isRequired: true }] };

      await expect(service.configure(dto, orgId)).rejects.toThrow(BadRequestException);
    });

    it('should reconfigure if no accounts exist', async () => {
      accountRepo.count.mockResolvedValue(0);
      const orgId = 'org-1';
      const dto = { segments: [{ name: 'N1', length: 5, isRequired: true }] };

      await service.configure(dto, orgId);

      expect(segmentRepo.delete).toHaveBeenCalledWith({ organizationId: orgId });
      expect(segmentRepo.save).toHaveBeenCalled();
    });
  });

  describe('mismatch validation', () => {
    it('should be handled by ChartOfAccountsService (contextual note)', () => {
      // This test is here to remind that the actual segment count mismatch
      // is handled during account creation in ChartOfAccountsService.createInTransaction
    });
  });
});
