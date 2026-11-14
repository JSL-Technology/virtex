
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { languageOfCountry } from '../markets';
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
import { JournalQueryService } from '../journal-entries/services/journal-query.service';
import { AccountSegment } from './entities/account-segment.entity';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';
import { AccountHistory } from './entities/account-history.entity';
import { AccountSegmentDefinition } from './entities/account-segment-definition.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { FiscalYear, FiscalYearStatus } from '../accounting/entities/fiscal-year.entity';
import { toIsoDate } from '../common/dates';
import { fiscalDate, organizationTimeZone } from '../shared/fiscal-clock';
import { JournalEntryLineValuation } from '../journal-entries/entities/journal-entry-line-valuation.entity';
import { MergeAccountsDto } from './dto/merge-accounts.dto';
import { AccountHierarchyVersion } from './entities/account-hierarchy-version.entity';
import { BadRequestError, ForbiddenError, NotFoundError } from '../i18n/localized.exception';
import { assertTenantOwns } from '../shared/tenancy/tenant-ownership';
import { likeTerm } from '../common/database/search-term';
import { ACCOUNT_CATEGORIES_BY_TYPE, isCategoryAllowedForType } from '@virtex/shared/types';

export interface MergePreviewAccount {
  id: string;
  code: string;
  name: Record<string, string>;
  type: AccountType;
  /** Posted debit − credit, base currency. */
  postedBalance: number;
}

export interface MergePreview {
  source: MergePreviewAccount;
  destination: MergePreviewAccount;
  /** Lines the merge repoints: the unposted ones only. A posted line is history. */
  linesToMove: number;
  linesInClosedPeriods: number;
  childAccountsToMove: number;
  /** Lines that STAY on the source because they are posted; their balance is reclassified. */
  postedLinesKept: number;
  /**
   * What the reclassification entry will move from the source to the destination: the source's
   * posted balance. Zero means no entry is posted at all.
   */
  reclassifiedAmount: number;
  /** Translation keys of every reason the merge would be refused. Empty means it may proceed. */
  blockers: string[];
  /** Translation keys of consequences the person should accept knowingly. */
  warnings: string[];
}

@Injectable()
export class ChartOfAccountsService {
  private readonly logger = new Logger(ChartOfAccountsService.name);

  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: TreeRepository<Account>,
    @InjectRepository(AccountHistory)
    private readonly accountHistoryRepository: Repository<AccountHistory>,
    private readonly dataSource: DataSource,
    private readonly auditTrailService: AuditTrailService,
    private readonly journalQuery: JournalQueryService,

    @InjectQueue('account-jobs') private readonly accountJobsQueue: Queue,
  ) {}

  /**
   * The category must refine the type (QA M-04): an EXPENSE account filed as CURRENT_ASSET is
   * summed into the balance sheet while it behaves as an expense. Checked on the API paths
   * (create, update); provisioning builds charts from reviewed templates.
   */
  static assertCategoryFitsType(type: string | undefined, category: string | undefined): void {
    if (!type || !category) return;
    if (!isCategoryAllowedForType(type, category)) {
      throw new BadRequestError('chart_of_accounts.category_does_not_match_type', {
        category,
        type,
        allowed: (ACCOUNT_CATEGORIES_BY_TYPE as Record<string, readonly string[]>)[type]?.join(', ') ?? '',
      });
    }
  }

  /**
   * When an account becomes valid, where nobody said: the first day of the oldest fiscal year the
   * tenant still has open — not today (FIN-COA-01).
   *
   * `effective_from` is what keeps a retired or reclassified account out of the periods it does not
   * belong to, and the column defaults to `CURRENT_DATE`. That default made every account of the
   * opening chart valid from the day the company signed up, so a company that signed up in November
   * could not post its opening balances, nor anything else from the year already under way: the
   * temporal guard answered 403 on account 1110 for a journal entry dated the 2nd. It bit every
   * account created after day one, too — an accountant adds a tax account precisely because
   * something has to be posted to it, and that something is usually already dated.
   *
   * The oldest OPEN year, not the current one: a tenant whose previous year is still open is
   * entitled to post in it. Where there is no fiscal calendar yet — provisioning writes the chart
   * before the first year exists — the first day of the current year in the tenant's own time zone,
   * which is the year `TenantBookkeepingProvisioner` is about to open.
   */
  static async defaultEffectiveFrom(manager: EntityManager, organizationId: string): Promise<string> {
    const oldestOpen = await manager
      .getRepository(FiscalYear)
      .createQueryBuilder('year')
      .select('MIN(year.startDate)', 'start')
      .where('year.organizationId = :organizationId', { organizationId })
      .andWhere('year.status = :status', { status: FiscalYearStatus.OPEN })
      .getRawOne<{ start: string | Date | null }>();
    if (oldestOpen?.start) return toIsoDate(oldestOpen.start);

    // Read as columns, not as the entity: `markets/` and the ledger must not depend on the
    // identity module (verify:boundaries), and the time zone is all that is needed here.
    const [organization] = await manager.query<Array<{ country: string | null; timezone: string | null }>>(
      `SELECT "country", "timezone" FROM "organizations" WHERE "id" = $1`,
      [organizationId],
    );
    return `${fiscalDate(organizationTimeZone(organization)).slice(0, 4)}-01-01`;
  }

  async create(
    createAccountDto: CreateAccountDto,
    organizationId: string,
    externalManager?: EntityManager,
  ): Promise<Account> {
    ChartOfAccountsService.assertCategoryFitsType(createAccountDto.type, createAccountDto.category);
    return this.createInTransaction(
      createAccountDto,
      organizationId,
      externalManager || this.accountRepository.manager,
    );
  }

  /**
   * The language a tenant keeps its books in, which is the key an account's name is stored under
   * (audit 2026-11-07, I18N-05). Every name used to be stored as `{ es: … }`, so a Brazilian ledger
   * claimed its Portuguese names were Spanish and a reader in Spanish saw them as translations.
   */
  private static async booksLanguage(manager: EntityManager, organizationId: string): Promise<string> {
    const rows: Array<{ language: string | null; country: string | null }> = await manager.query(
      `SELECT "books_language" AS language, "country" FROM "organizations" WHERE "id" = $1`,
      [organizationId],
    );
    // The opening chart is written before provisioning fixes `books_language`, so the country's
    // statutory language is the answer until then — the same rule the provisioner applies.
    const language = (rows[0]?.language || languageOfCountry(rows[0]?.country) || '').slice(0, 2).toLowerCase();
    return /^[a-z]{2}$/.test(language) ? language : 'es';
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

    // The parent must be one of THIS organization's accounts (audit 2026-10-31, COA-01: a parent
    // from another tenant was accepted, and the other company's account came back as `parent`).
    await assertTenantOwns(manager, Account, parentId, organizationId, {
      errorKey: 'chart_of_accounts.parent_account_not_found',
      field: 'parentId',
    });

    const segmentDefinitions = await manager.find(AccountSegmentDefinition, {
      where: { organizationId },
      order: { order: 'ASC' },
    });

    if (segmentDefinitions.length === 0) {
      throw new BadRequestError('chart_of_accounts.account_segment_structure_has_not_configured');
    }

    if (segmentValues.length !== segmentDefinitions.length) {
      throw new BadRequestError('chart_of_accounts.number_segments_supplied_length_does_not', { length: segmentValues.length, length2: segmentDefinitions.length });
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
      throw new BadRequestError('chart_of_accounts.account_code_full_code_already_exists', { fullCode });
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
      throw new BadRequestError(
        createAccountDto.isContraAccount
          ? 'chart_of_accounts.contra_account_needs_opposite_nature'
          : 'chart_of_accounts.nature_does_not_match_type',
      );
    }


    const { name, description, effectiveFrom, effectiveTo, ...restOfDto } = accountData;
    const language = await ChartOfAccountsService.booksLanguage(manager, organizationId);
    const entityData: Partial<Account> = {
      ...restOfDto,
      organizationId,
      parentId: parentId || null,
      code: fullCode,
      name: typeof name === 'string' ? { [language]: name } : name,
    };
    if (description) {
      entityData.description = typeof description === 'string' ? { [language]: description } : description;
    }
    entityData.effectiveFrom = effectiveFrom
      ? (effectiveFrom as unknown as Date)
      : ((await ChartOfAccountsService.defaultEffectiveFrom(manager, organizationId)) as unknown as Date);
    if (effectiveTo) {
      entityData.effectiveTo = effectiveTo as unknown as Date;
    }

    const account = manager.create(Account, entityData);

    const segments = segmentValues.map((value, index) => {
      const def = segmentDefinitions[index];
      if (value.length !== def.length) {
        throw new BadRequestError('chart_of_accounts.segment_name_value_value_must_length', { name: def.name, value, length: def.length });
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

  /**
   * El plan contable del inquilino, opcionalmente acotado.
   *
   * Ambos parámetros opcionales; omitirlos es lo de siempre. Existen para los selectores de cuenta
   * —el asiento manual, el ajuste de auditoría, la factura de proveedor, el padre de una cuenta—,
   * que se traían el plan entero: en una empresa real ronda las mil cuentas, cada una con sus
   * relaciones cargadas, para enseñar diez filas.
   *
   * El NOMBRE es una columna `jsonb` con una traducción por idioma, así que se busca sobre su
   * texto: buscar solo en el idioma del lector dejaría fuera la cuenta que alguien nombró en otro.
   */
  async findAllForOrg(
    organizationId: string,
    options: { search?: string; limit?: number } = {},
  ): Promise<Account[]> {
    const query = this.accountRepository
      .createQueryBuilder('account')
      .leftJoinAndSelect('account.parent', 'parent')
      .leftJoinAndSelect('account.segments', 'segments')
      .where('account.organizationId = :organizationId', { organizationId });

    const term = likeTerm(options.search);
    if (term) {
      query.andWhere('(account.code ILIKE :term OR account.name::text ILIKE :term)', { term });
    }

    if (options.limit !== undefined && options.limit > 0) {
      query.take(options.limit);
    }

    const accounts = await query.getMany();

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
      throw new NotFoundError('chart_of_accounts.account_id_not_found', { id });
    }
    // Defence in depth: a relation loaded by id must never surface another tenant's row, even if
    // one was linked before references were validated (rows written before 2026-11).
    account.children = (account.children ?? []).filter((child) => child.organizationId === organizationId);
    if (account.parent && account.parent.organizationId !== organizationId) {
      account.parent = null as never;
    }
    return account;
  }

  /** A parent cannot be the account itself or one of its descendants: the tree would loop. */
  private async assertNotOwnDescendant(
    manager: EntityManager,
    accountId: string,
    parentId: string,
    organizationId: string,
  ): Promise<void> {
    if (parentId === accountId) {
      throw new BadRequestError('chart_of_accounts.parent_cannot_be_descendant');
    }
    const [row] = await manager.query(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM accounts WHERE parent_id = $1 AND organization_id = $3
         UNION
         SELECT a.id FROM accounts a JOIN descendants d ON a.parent_id = d.id WHERE a.organization_id = $3
       )
       SELECT EXISTS (SELECT 1 FROM descendants WHERE id = $2) AS loops`,
      [accountId, parentId, organizationId],
    );
    if (row?.loops) {
      throw new BadRequestError('chart_of_accounts.parent_cannot_be_descendant');
    }
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
        throw new NotFoundError('chart_of_accounts.account_id_not_found', { id });
      }

      if (
        updateAccountDto.segments &&
        updateAccountDto.segments.join('-') !== account.code
      ) {
        throw new BadRequestError('chart_of_accounts.account_code_segments_cannot_changed');
      }
      if (updateAccountDto.type && updateAccountDto.type !== account.type) {
        throw new BadRequestError('chart_of_accounts.account_type_cannot_changed');
      }
      if (updateAccountDto.category && updateAccountDto.category !== account.category) {
        ChartOfAccountsService.assertCategoryFitsType(account.type, updateAccountDto.category);
      }

      const { reasonForChange, parentId, segments, ...accountDataDto } =
        updateAccountDto;


      const { name, description, effectiveFrom, effectiveTo, ...restOfDto } = accountDataDto;
      const updatePayload: Partial<Account> = { ...restOfDto };

      // A plain string replaces the name in the books language and keeps the other translations
      // (audit 2026-11-07, I18N-05): it used to overwrite the whole object with `{ es: … }`.
      const language = await ChartOfAccountsService.booksLanguage(manager, organizationId);
      if (name) {
        updatePayload.name = typeof name === 'string' ? { ...(account.name ?? {}), [language]: name } : name;
      }
      if (description) {
        updatePayload.description =
          typeof description === 'string' ? { ...(account.description ?? {}), [language]: description } : description;
      }
      if (effectiveFrom) {
        updatePayload.effectiveFrom = new Date(effectiveFrom);
      }
      if (effectiveTo) {
        updatePayload.effectiveTo = new Date(effectiveTo);
      }


      if (parentId !== undefined && parentId !== account.parentId) {
        await assertTenantOwns(manager, Account, parentId, organizationId, {
          errorKey: 'chart_of_accounts.parent_account_not_found',
          field: 'parentId',
        });
        if (parentId) await this.assertNotOwnDescendant(manager, id, parentId, organizationId);
        const hasMovements = await this.journalQuery.hasMovementsForAccount(id, manager);
        if (hasMovements) {
          throw new BadRequestError('chart_of_accounts.hierarchy_account_p1_cannot_changed_because', { p1: account.name['es'] });
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
        throw new BadRequestError('chart_of_accounts.invalid_account_type_type', { type });
    }
  }


  /**
   * What a merge of `sourceAccountId` into `destinationAccountId` would do, and whether it may.
   *
   * The wizard used to answer this with invented figures — «42 transactions, balance 1,500.75» —
   * for every pair of accounts, and the server learnt of a refusal only when it tried to perform
   * it. Worse, what it promised was not what a merge may do: it said every line would move, and a
   * posted line cannot (FIN-COA-02). The job tried anyway, the immutability triggers refused it,
   * and the merge of any account with a single posted movement failed after telling the person it
   * had started.
   *
   * So this now describes what actually happens, from the tenant's own ledger:
   *
   *  - `linesToMove` — the UNPOSTED lines, which are repointed because a draft is not history;
   *  - `postedLinesKept` — the posted ones, which stay where they are, for ever;
   *  - `reclassifiedAmount` — the source's posted balance, which a dated reclassification entry
   *    moves to the destination, so the source reads zero and the destination reads the combined
   *    figure without a single posted row being rewritten.
   *
   * Blockers are the server's refusals, stated in advance; `merge` enforces the same list.
   */
  async previewMerge(
    sourceAccountId: string,
    destinationAccountId: string,
    organizationId: string,
  ): Promise<MergePreview> {
    if (sourceAccountId === destinationAccountId) {
      throw new BadRequestError('chart_of_accounts.source_destination_accounts_cannot_same');
    }
    const [source, destination] = await Promise.all([
      this.accountRepository.findOne({ where: { id: sourceAccountId, organizationId } }),
      this.accountRepository.findOne({ where: { id: destinationAccountId, organizationId } }),
    ]);
    if (!source || !destination) {
      throw new NotFoundError('chart_of_accounts.one_both_accounts_not_found');
    }

    const [sourceMovements, destinationMovements, childAccounts] = await Promise.all([
      this.journalQuery.summarizeAccountMovements(source.id, organizationId),
      this.journalQuery.summarizeAccountMovements(destination.id, organizationId),
      this.accountRepository.count({ where: { parentId: source.id, organizationId } }),
    ]);

    const blockers: string[] = [];
    if (!source.isPostable || !destination.isPostable) {
      blockers.push('chart_of_accounts.both_accounts_must_postable_merged');
    }
    if (source.isSystemAccount) blockers.push('chart_of_accounts.system_accounts_cannot_merged');
    //  An asset folded into an expense would move its history from the balance sheet to the income
    //  statement — for every period, closed ones included. Same type or nothing.
    if (source.type !== destination.type) blockers.push('chart_of_accounts.merge_types_must_match');
    if (!destination.isActive) blockers.push('chart_of_accounts.merge_destination_inactive');

    const warnings: string[] = [];
    // What a merge does to the ledger, said before it is run rather than discovered afterwards:
    // the posted lines stay where they are and their balance is moved by a dated entry.
    if (sourceMovements.postedLines > 0) warnings.push('chart_of_accounts.merge_reclassifies_posted_balance');

    return {
      source: this.mergeSide(source, sourceMovements.postedBalance),
      destination: this.mergeSide(destination, destinationMovements.postedBalance),
      linesToMove: sourceMovements.unpostedLines,
      linesInClosedPeriods: sourceMovements.linesInClosedPeriods,
      childAccountsToMove: childAccounts,
      postedLinesKept: sourceMovements.postedLines,
      reclassifiedAmount: sourceMovements.postedBalance,
      blockers,
      warnings,
    };
  }

  private mergeSide(account: Account, postedBalance: number): MergePreviewAccount {
    return {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      postedBalance,
    };
  }

  async merge(
    dto: MergeAccountsDto,
    organizationId: string,
    userId: string,
  ): Promise<{ jobId: string; messageKey: string; messageParams: Record<string, string> }> {
    const preview = await this.previewMerge(dto.sourceAccountId, dto.destinationAccountId, organizationId);
    if (preview.blockers.length > 0) {
      // The first refusal, as the API has always reported it; the wizard shows all of them first.
      const [first] = preview.blockers;
      if (first === 'chart_of_accounts.system_accounts_cannot_merged') throw new ForbiddenError(first);
      throw new BadRequestError(first);
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
      messageKey: 'chart_of_accounts.merge_started',
      messageParams: { source: preview.source.code, destination: preview.destination.code },
    };
  }




  async blockForPosting(
    accountId: string,
    organizationId: string,
    userId: string,
  ): Promise<Account> {
    const account = await this.findOne(accountId, organizationId);
    if (account.isBlockedForPosting) {
      throw new BadRequestError('chart_of_accounts.account_already_locked');
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
      throw new BadRequestError('chart_of_accounts.account_not_locked');
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
      throw new BadRequestError('chart_of_accounts.system_accounts_cannot_deactivated');
    }
    if (account.children && account.children.length > 0) {
      throw new BadRequestError('chart_of_accounts.account_cannot_deactivated_because_has_child');
    }
    const hasTransactions = await this.journalQuery.hasMovementsForAccount(id);
    if (hasTransactions) {
      throw new BadRequestError('chart_of_accounts.account_cannot_deactivated_because_has_transactions');
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
        throw new BadRequestError('chart_of_accounts.one_more_specified_accounts_not_found');
      }
      const errors: string[] = [];
      const accountsToDeactivate: Account[] = [];
      const movementCounts = await this.journalQuery.countMovementsByAccountIds(accountIds);
      const transactionMap = new Map(
        movementCounts.map((mc) => [mc.accountId, mc.count]),
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
