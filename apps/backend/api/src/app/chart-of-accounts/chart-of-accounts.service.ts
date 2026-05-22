
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  TreeRepository,
  EntityManager,
  In,
  DataSource,
} from 'typeorm';
import {
  paginate,
  Pagination,
  IPaginationOptions,
} from 'nestjs-typeorm-paginate';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { Account } from './entities/account.entity';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { AccountNature, AccountType } from './enums/account-enums';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { AccountSegment } from './entities/account-segment.entity';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';
import { AccountHistory } from './entities/account-history.entity';
import { AccountSegmentDefinition } from './entities/account-segment-definition.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { JournalEntryLineValuation } from '../journal-entries/entities/journal-entry-line-valuation.entity';
import { MergeAccountsDto } from './dto/merge-accounts.dto';
import { AccountBalance } from './entities/account-balance.entity';

import { AccountHierarchyVersion } from './entities/account-hierarchy-version.entity';

@Injectable()
export class ChartOfAccountsService {
  private readonly logger = new Logger(ChartOfAccountsService.name);

  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: TreeRepository<Account>,
    @InjectRepository(JournalEntryLine)
    private readonly journalEntryLineRepository: Repository<JournalEntryLine>,
    @InjectRepository(AccountHistory)
    private readonly accountHistoryRepository: Repository<AccountHistory>,
    private readonly dataSource: DataSource,
    private readonly auditTrailService: AuditTrailService,

    @InjectQueue('account-jobs') private readonly accountJobsQueue: Queue,
  ) {}

  async create(
    createAccountDto: CreateAccountDto,
    organizationId: string,
    externalManager?: EntityManager,
  ): Promise<Account> {
    return this.createInTransaction(
      createAccountDto,
      organizationId,
      externalManager || this.accountRepository.manager,
    );
  }

  async createInTransaction(
    createAccountDto: CreateAccountDto,
    organizationId: string,
    manager: EntityManager,
  ): Promise<Account> {
    const {
      parentId,
      segments: segmentValues,
      ...accountData
    } = createAccountDto;

    const segmentDefinitions = await manager.find(AccountSegmentDefinition, {
      where: { organizationId },
      order: { order: 'ASC' },
    });

    if (segmentDefinitions.length === 0) {
      throw new BadRequestException(
        'La estructura de segmentos de cuenta no ha sido configurada para esta organización.',
      );
    }

    if (segmentValues.length !== segmentDefinitions.length) {
      throw new BadRequestException(
        `El número de segmentos proporcionados (${segmentValues.length}) no coincide con la definición de la organización (${segmentDefinitions.length}).`,
      );
    }

    const fullCode = segmentValues.join('-');
    const existingAccount = await manager
      .createQueryBuilder(Account, 'account')
      .innerJoin('account.segments', 'segment')
      .where('account.organizationId = :organizationId', { organizationId })
      .groupBy('account.id')
      .having(
        "STRING_AGG(segment.value, '-' ORDER BY segment.order) = :fullCode",
        { fullCode },
      )
      .getOne();

    if (existingAccount) {
      throw new BadRequestException(
        `El código de cuenta '${fullCode}' ya existe.`,
      );
    }

    const nature = this.getNatureFromType(accountData.type);
    if (nature !== accountData.nature) {
      throw new BadRequestException(
        `La naturaleza de la cuenta no corresponde a su tipo.`,
      );
    }


    const { name, description, effectiveFrom, effectiveTo, ...restOfDto } = accountData;
    const entityData: Partial<Account> = {
      ...restOfDto,
      organizationId,
      parentId: parentId || null,
      name: typeof name === 'string' ? { es: name } : name,
    };
    if (description) {
      entityData.description = typeof description === 'string' ? { es: description } : description;
    }
    if (effectiveFrom) {
      entityData.effectiveFrom = new Date(effectiveFrom);
    }
    if (effectiveTo) {
      entityData.effectiveTo = new Date(effectiveTo);
    }

    const account = manager.create(Account, entityData);

    const segments = segmentValues.map((value, index) => {
      const def = segmentDefinitions[index];
      if (value.length !== def.length) {
        throw new BadRequestException(
          `El segmento '${def.name}' (valor: ${value}) debe tener una longitud de ${def.length} caracteres.`,
        );
      }
      return manager.create(AccountSegment, { order: def.order, value });
    });
    account.segments = segments;

    const savedAccount = await manager.save(account);


    const hierarchyVersion = manager.create(AccountHierarchyVersion, {
      accountId: savedAccount.id,
      parentId: parentId,
      effectiveDate: new Date(),
    });
    await manager.save(hierarchyVersion);

    return savedAccount;
  }

  async findAllForOrg(organizationId: string): Promise<Account[]> {
    const accounts = await this.accountRepository.find({
      where: { organizationId },
      relations: ['parent', 'balances', 'segments'],
    });

    accounts.forEach((acc) => {
      if (acc.segments) {
        acc.segments.sort((a, b) => a.order - b.order);
      }
    });

    return accounts.sort((a, b) => a.code.localeCompare(b.code));
  }

  async findOne(id: string, organizationId: string): Promise<Account> {
    const account = await this.accountRepository.findOne({
      where: { id, organizationId },
      relations: ['children', 'parent', 'segments', 'history'],
    });
    if (!account) {
      throw new NotFoundException(
        `Cuenta contable con ID "${id}" no encontrada.`,
      );
    }
    return account;
  }

  async update(
    id: string,
    updateAccountDto: UpdateAccountDto,
    organizationId: string,
    userId: string,
  ): Promise<Account> {
    return this.dataSource.transaction(async (manager) => {
      const accountRepo = manager.getTreeRepository(Account);
      const historyRepo = manager.getRepository(AccountHistory);
      const hierarchyRepo = manager.getRepository(AccountHierarchyVersion);

      const account = await accountRepo.findOne({
        where: { id, organizationId },
        relations: ['parent', 'segments'],
      });

      if (!account) {
        throw new NotFoundException(
          `Cuenta contable con ID "${id}" no encontrada.`,
        );
      }

      if (
        updateAccountDto.segments &&
        updateAccountDto.segments.join('-') !== account.code
      ) {
        throw new BadRequestException(
          'El código de la cuenta (segmentos) no puede ser modificado.',
        );
      }
      if (updateAccountDto.type && updateAccountDto.type !== account.type) {
        throw new BadRequestException(
          'El tipo de cuenta no puede ser modificado.',
        );
      }

      const { reasonForChange, parentId, segments, ...accountDataDto } =
        updateAccountDto;


      const { name, description, effectiveFrom, effectiveTo, ...restOfDto } = accountDataDto;
      const updatePayload: Partial<Account> = { ...restOfDto };

      if (name) {
        updatePayload.name = typeof name === 'string' ? { es: name } : name;
      }
      if (description) {
        updatePayload.description = typeof description === 'string' ? { es: description } : description;
      }
      if (effectiveFrom) {
        updatePayload.effectiveFrom = new Date(effectiveFrom);
      }
      if (effectiveTo) {
        updatePayload.effectiveTo = new Date(effectiveTo);
      }


      if (parentId !== undefined && parentId !== account.parentId) {
        const transactionCount = await manager.count(JournalEntryLine, {
          where: { accountId: id },
        });
        if (transactionCount > 0) {
          throw new BadRequestException(
            `No se puede cambiar la jerarquía de la cuenta "${account.name['es']}" porque tiene transacciones. Considere la fusión de cuentas.`,
          );
        }

        const hierarchyVersion = hierarchyRepo.create({
          accountId: id,
          parentId: parentId,
          effectiveDate: new Date(),
        });
        await hierarchyRepo.save(hierarchyVersion);
      }

      const previousValue = { ...account };
      delete (previousValue as any).children;

      const updatedAccountEntity = accountRepo.merge(account, updatePayload);

      if (parentId !== undefined) {
        updatedAccountEntity.parentId = parentId;

      }

      const newValue = { ...updatedAccountEntity };
      delete (newValue as any).children;

      const historyEntry = historyRepo.create({
        accountId: id,
        previousValue,
        newValue,
        reasonForChange,
        changedByUserId: userId,
        version: account.version + 1,
      });
      await historyRepo.save(historyEntry);

      return accountRepo.save(updatedAccountEntity);
    });
  }

  private getNatureFromType(type: AccountType): AccountNature {
    switch (type) {
      case AccountType.ASSET:
      case AccountType.EXPENSE:
        return AccountNature.DEBIT;
      case AccountType.LIABILITY:
      case AccountType.EQUITY:
      case AccountType.REVENUE:
        return AccountNature.CREDIT;
      default:
        throw new BadRequestException(`Tipo de cuenta inválido: ${type}`);
    }
  }


  async merge(
    dto: MergeAccountsDto,
    organizationId: string,
    userId: string,
  ): Promise<{ jobId: string; message: string }> {
    const { sourceAccountId, destinationAccountId } = dto;

    if (sourceAccountId === destinationAccountId) {
      throw new BadRequestException(
        'La cuenta de origen y destino no pueden ser la misma.',
      );
    }


    const [sourceAccount, destAccount] = await Promise.all([
      this.accountRepository.findOne({
        where: { id: sourceAccountId, organizationId },
      }),
      this.accountRepository.findOne({
        where: { id: destinationAccountId, organizationId },
      }),
    ]);

    if (!sourceAccount || !destAccount) {
      throw new NotFoundException('Una o ambas cuentas no fueron encontradas.');
    }
    if (!sourceAccount.isPostable || !destAccount.isPostable) {
      throw new BadRequestException(
        'Ambas cuentas deben permitir contabilización para poder ser fusionadas.',
      );
    }
    if (sourceAccount.isSystemAccount) {
      throw new ForbiddenException(
        'Las cuentas de sistema no pueden ser fusionadas.',
      );
    }


    const job = await this.accountJobsQueue.add(
      'merge-accounts',
      {
        dto,
        organizationId,
        userId,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    this.logger.log(`Job de fusión de cuentas encolado con ID: ${job.id}`);

    return {
      jobId: job.id as string,
      message: `El proceso de fusión de la cuenta ${sourceAccount.code} en ${destAccount.code} ha sido iniciado. Se le notificará al completarse.`,
    };
  }




  async blockForPosting(
    accountId: string,
    organizationId: string,
    userId: string,
  ): Promise<Account> {
    const account = await this.findOne(accountId, organizationId);
    if (account.isBlockedForPosting) {
      throw new BadRequestException('La cuenta ya está bloqueada.');
    }
    const previousValue = { isBlockedForPosting: account.isBlockedForPosting };
    account.isBlockedForPosting = true;
    account.blockedAt = new Date();
    account.blockedByUserId = userId;
    const updatedAccount = await this.accountRepository.save(account);
    await this.auditTrailService.record(
      userId,
      'accounts',
      accountId,
      ActionType.UPDATE,
      { isBlockedForPosting: true },
      previousValue,
    );
    return updatedAccount;
  }

  async unblockForPosting(
    accountId: string,
    organizationId: string,
    userId: string,
  ): Promise<Account> {
    const account = await this.findOne(accountId, organizationId);
    if (!account.isBlockedForPosting) {
      throw new BadRequestException('La cuenta no está bloqueada.');
    }
    const previousValue = { isBlockedForPosting: account.isBlockedForPosting };
    account.isBlockedForPosting = false;
    account.blockedAt = null;
    account.blockedByUserId = null;
    const updatedAccount = await this.accountRepository.save(account);
    await this.auditTrailService.record(
      userId,
      'accounts',
      accountId,
      ActionType.UPDATE,
      { isBlockedForPosting: false },
      previousValue,
    );
    return updatedAccount;
  }

  async deactivate(
    id: string,
    organizationId: string,
  ): Promise<{ message: string; account: Account }> {
    const account = await this.findOne(id, organizationId);
    if (account.isSystemAccount) {
      throw new BadRequestException(
        'Las cuentas del sistema no pueden ser desactivadas.',
      );
    }
    if (account.children && account.children.length > 0) {
      throw new BadRequestException(
        `La cuenta no puede ser desactivada porque tiene cuentas hijas.`,
      );
    }
    const firstTransaction = await this.journalEntryLineRepository.findOne({
      where: { accountId: id },
    });
    if (firstTransaction) {
      throw new BadRequestException(
        `La cuenta no puede ser desactivada porque tiene transacciones asociadas.`,
      );
    }
    account.isActive = false;
    const deactivatedAccount = await this.accountRepository.save(account);
    return {
      message: `La cuenta "${deactivatedAccount.name['es']}" ha sido desactivada.`,
      account: deactivatedAccount,
    };
  }

  async findTreeRoots(
    organizationId: string,
    options: IPaginationOptions,
  ): Promise<Pagination<Account>> {
    const queryBuilder = this.accountRepository
      .createQueryBuilder('account')
      .leftJoinAndSelect('account.segments', 'segment')
      .where('account.organizationId = :organizationId', { organizationId })
      .andWhere('account.parentId IS NULL')
      .orderBy('segment.value', 'ASC');
    return paginate<Account>(queryBuilder, options);
  }

  async findChildrenOf(
    parentId: string,
    organizationId: string,
  ): Promise<Account[]> {
    const parent = await this.findOne(parentId, organizationId);
    return this.accountRepository.findDescendants(parent, { depth: 1 });
  }

  async batchDeactivate(
    accountIds: string[],
    organizationId: string,
  ): Promise<{ success: boolean; deactivated: number; errors: string[] }> {

    return this.dataSource.transaction(async (manager) => {
      const accounts = await manager.find(Account, {
        where: { id: In(accountIds), organizationId },
        relations: ['children', 'segments'],
      });
      if (accounts.length !== accountIds.length) {
        throw new BadRequestException(
          'Una o más de las cuentas especificadas no fueron encontradas.',
        );
      }
      const errors: string[] = [];
      const accountsToDeactivate: Account[] = [];
      const transactionCounts = await manager
        .getRepository(JournalEntryLine)
        .createQueryBuilder('line')
        .select('line.accountId', 'accountId')
        .addSelect('COUNT(line.id)', 'count')
        .where('line.accountId IN (:...accountIds)', { accountIds })
        .groupBy('line.accountId')
        .getRawMany();
      const transactionMap = new Map(
        transactionCounts.map((tc) => [tc.accountId, parseInt(tc.count, 10)]),
      );
      for (const account of accounts) {
        if (account.isSystemAccount) {
          errors.push(`La cuenta ${account.code} es de sistema.`);
        } else if (account.children && account.children.length > 0) {
          errors.push(`La cuenta ${account.code} tiene cuentas hijas.`);
        } else if (transactionMap.has(account.id)) {
          errors.push(`La cuenta ${account.code} tiene transacciones.`);
        } else {
          account.isActive = false;
          accountsToDeactivate.push(account);
        }
      }
      if (accountsToDeactivate.length > 0) {
        await manager.save(accountsToDeactivate);
      }
      return {
        success: errors.length === 0,
        deactivated: accountsToDeactivate.length,
        errors,
      };
    });
  }

  async getAccountHistory(
    accountId: string,
    organizationId: string,
  ): Promise<AccountHistory[]> {
    await this.findOne(accountId, organizationId);
    return this.accountHistoryRepository.find({
      where: { accountId },
      order: { changedAt: 'DESC' },
      relations: ['changedByUser'],
    });
  }
}
