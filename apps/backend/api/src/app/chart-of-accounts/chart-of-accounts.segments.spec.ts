import { Test, TestingModule } from '@nestjs/testing';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Account } from './entities/account.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { AccountHistory } from './entities/account-history.entity';
import { DataSource } from 'typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { AuditTrailService } from '../audit/audit.service';
import { AccountSegmentDefinition } from './entities/account-segment-definition.entity';
import { BadRequestException } from '@nestjs/common';

describe('ChartOfAccountsService - Segment Mismatch', () => {
  let service: ChartOfAccountsService;
  let manager: any;

  beforeEach(async () => {
    manager = {
      find: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        having: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      })),
      create: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChartOfAccountsService,
        { provide: getRepositoryToken(Account), useValue: {} },
        { provide: getRepositoryToken(JournalEntryLine), useValue: {} },
        { provide: getRepositoryToken(AccountHistory), useValue: {} },
        { provide: DataSource, useValue: { manager } },
        { provide: AuditTrailService, useValue: {} },
        { provide: getQueueToken('account-jobs'), useValue: {} },
      ],
    }).compile();

    service = module.get<ChartOfAccountsService>(ChartOfAccountsService);
  });

  it('should throw BadRequestException if number of segments mismatch', async () => {
    const orgId = 'org-1';
    const segmentDefinitions = [
      { id: '1', name: 'N1', length: 1, order: 0 },
      { id: '2', name: 'N2', length: 2, order: 1 },
    ];

    manager.find.mockResolvedValue(segmentDefinitions);

    const createDto: any = {
      code: '1-10-05', // 3 segments
      segments: ['1', '10', '05'],
      name: 'Test Account',
      type: 'ASSET',
      category: 'CASH',
      nature: 'DEBIT',
    };

    await expect(service.createInTransaction(createDto, orgId, manager))
      .rejects.toThrow(BadRequestException);

    await expect(service.createInTransaction(createDto, orgId, manager))
      .rejects.toThrow(/El número de segmentos proporcionados \(3\) no coincide con la definición de la organización \(2\)/);
  });
});
