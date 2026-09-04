
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
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

import { AccountHierarchyVersion } from './entities/account-hierarchy-version.entity';
import { BadRequestError, ForbiddenError, NotFoundError } from '../i18n/localized.exception';

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
      throw new BadRequestError('CHART_OF_ACCOUNTS.ESTRUCTURA_SEGMENTOS_CUENTA_NO_HA_SIDO_CONFIGURADA');
    }

    if (segmentValues.length !== segmentDefinitions.length) {
      throw new BadRequestError('CHART_OF_ACCOUNTS.NUMERO_SEGMENTOS_PROPORCIONADOS_NO_COINCIDE_DEFINICION_ORGANIZACION', { length: segmentValues.length, length2: segmentDefinitions.length });
    }

    const fullCode = segmentValues.join('-');
    // An indexed equality on a stored column, not a `STRING_AGG ... GROUP BY ... HAVING` aggregate
    // over every account of the organization. The unique index on (organization_id, code) is what
    // actually enforces this — the check is here to produce a readable error rather than a
    // constraint violation, and it is no longer the only thing standing between two concurrent
    // requests and two accounts numbered 1101.
    const existingAccount = await manager.findOne(Account, {
      where: { organizationId, code: fullCode },
    });

    if (existingAccount) {
      throw new BadRequestError('CHART_OF_ACCOUNTS.CODIGO_CUENTA_YA_EXISTE', { fullCode });
    }

    // The nature must match the type's normal balance — UNLESS the account declares itself a
    // contra account, in which case it must be the opposite.
    //
    // The rule used to be an unconditional equality, which forbade contra accounts outright:
    // accumulated depreciation, an allowance for doubtful accounts and sales returns are all an
    // account whose balance runs against its type, and all three are in the opening chart every
    // tenant is provisioned with. So the check rejected the product's own templates on the second
    // account it reached. Making the exception explicit keeps the guard doing its real job —
    // catching a nature chosen by mistake — while allowing the case accounting actually requires.
    const normalNature = this.getNatureFromType(accountData.type);
    const expectedNature = createAccountDto.isContraAccount
      ? this.oppositeNature(normalNature)
      : normalNature;

    if (expectedNature !== accountData.nature) {
      throw new BadRequestException(
        createAccountDto.isContraAccount
          ? 'Una cuenta de naturaleza contraria debe llevar la naturaleza opuesta a la de su tipo.'
          : 'La naturaleza de la cuenta no corresponde a su tipo. Si es una cuenta de naturaleza contraria (depreciación acumulada, provisiones, devoluciones), márcala como tal.',
      );
    }


    const { name, description, effectiveFrom, effectiveTo, ...restOfDto } = accountData;
    const entityData: Partial<Account> = {
      ...restOfDto,
      organizationId,
      parentId: parentId || null,
      code: fullCode,
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
        throw new BadRequestError('CHART_OF_ACCOUNTS.SEGMENTO_VALOR_DEBE_TENER_LONGITUD_CARACTERES', { name: def.name, value, length: def.length });
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
      relations: ['parent', 'segments'],
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
      throw new NotFoundError('CHART_OF_ACCOUNTS.CUENTA_CONTABLE_ID_NO_ENCONTRADA', { id });
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
        throw new NotFoundError('CHART_OF_ACCOUNTS.CUENTA_CONTABLE_ID_NO_ENCONTRADA', { id });
      }

      if (
        updateAccountDto.segments &&
        updateAccountDto.segments.join('-') !== account.code
      ) {
        throw new BadRequestError('CHART_OF_ACCOUNTS.CODIGO_CUENTA_SEGMENTOS_NO_PUEDE_SER_MODIFICADO');
      }
      if (updateAccountDto.type && updateAccountDto.type !== account.type) {
        throw new BadRequestError('CHART_OF_ACCOUNTS.TIPO_CUENTA_NO_PUEDE_SER_MODIFICADO');
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
          throw new BadRequestError('CHART_OF_ACCOUNTS.NO_PUEDE_CAMBIAR_JERARQUIA_CUENTA_PORQUE_TIENE', { p1: account.name['es'] });
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

  private oppositeNature(nature: AccountNature): AccountNature {
    return nature === AccountNature.DEBIT ? AccountNature.CREDIT : AccountNature.DEBIT;
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
        throw new BadRequestError('CHART_OF_ACCOUNTS.TIPO_CUENTA_INVALIDO', { type });
    }
  }


  async merge(
    dto: MergeAccountsDto,
    organizationId: string,
    userId: string,
  ): Promise<{ jobId: string; message: string }> {
    const { sourceAccountId, destinationAccountId } = dto;

    if (sourceAccountId === destinationAccountId) {
      throw new BadRequestError('CHART_OF_ACCOUNTS.CUENTA_ORIGEN_DESTINO_NO_PUEDEN_SER_MISMA');
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
      throw new NotFoundError('CHART_OF_ACCOUNTS.AMBAS_CUENTAS_NO_FUERON_ENCONTRADAS');
    }
    if (!sourceAccount.isPostable || !destAccount.isPostable) {
      throw new BadRequestError('CHART_OF_ACCOUNTS.AMBAS_CUENTAS_DEBEN_PERMITIR_CONTABILIZACION_PODER_SER');
    }
    if (sourceAccount.isSystemAccount) {
      throw new ForbiddenError('CHART_OF_ACCOUNTS.CUENTAS_SISTEMA_NO_PUEDEN_SER_FUSIONADAS');
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
      throw new BadRequestError('CHART_OF_ACCOUNTS.CUENTA_YA_ESTA_BLOQUEADA');
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
      throw new BadRequestError('CHART_OF_ACCOUNTS.CUENTA_NO_ESTA_BLOQUEADA');
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
      throw new BadRequestError('CHART_OF_ACCOUNTS.CUENTAS_SISTEMA_NO_PUEDEN_SER_DESACTIVADAS');
    }
    if (account.children && account.children.length > 0) {
      throw new BadRequestError('CHART_OF_ACCOUNTS.CUENTA_NO_PUEDE_SER_DESACTIVADA_PORQUE_TIENE');
    }
    const firstTransaction = await this.journalEntryLineRepository.findOne({
      where: { accountId: id },
    });
    if (firstTransaction) {
      throw new BadRequestError('CHART_OF_ACCOUNTS.CUENTA_NO_PUEDE_SER_DESACTIVADA_PORQUE_TIENE_2');
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
        throw new BadRequestError('CHART_OF_ACCOUNTS.MAS_CUENTAS_ESPECIFICADAS_NO_FUERON_ENCONTRADAS');
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
