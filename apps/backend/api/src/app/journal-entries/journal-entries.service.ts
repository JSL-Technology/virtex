import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository, DataSource, QueryRunner } from 'typeorm';
import {
  JournalEntry,
  JournalEntryStatus,
} from './entities/journal-entry.entity';
import { JournalEntryLine } from './entities/journal-entry-line.entity';
import { JournalEntryType } from './entities/journal-entry.entity';
import {
  CreateJournalEntryDto,
  CreateJournalEntryLineDto,
} from './dto/create-journal-entry.dto';
import { Account, AccountType } from '../chart-of-accounts/entities/account.entity';
import {
  UpdateJournalEntryDto,
  ReverseJournalEntryDto,
} from './dto/journal-entry-actions.dto';
import { StorageService } from '../storage/storage.service';
import { JournalEntryAttachment } from './entities/journal-entry-attachment.entity';
import { ModuleSlug } from '../accounting/entities/accounting-period.entity';
import { resolvePostingPeriod } from '../accounting/period-status';
import { BudgetControlService } from '../budgets/budget-control.service';
import { toIsoDate } from '../common/dates';
import { AccountPeriodLock } from '../accounting/entities/account-period-lock.entity';
import { Journal } from './entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { WorkflowsService } from '../workflows/workflows.service';
import { DocumentTypeForApproval } from '../workflows/entities/approval-policy.entity';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Readable } from 'stream';
import { DimensionRule } from '../dimensions/entities/dimension-rule.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { JournalEntryLineValuation } from './entities/journal-entry-line-valuation.entity';
import { LedgerMappingRule } from '../accounting/entities/ledger-mapping-rule.entity';
import { SaasService } from '../saas/saas.service';
import { SaasResource } from '../saas/enums/saas-resource.enum';
import {
  FastifyFile,
  toUploadableFile,
} from '../common/interfaces/fastify-file.interface';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../i18n/localized.exception';
import {
  MoneyError,
  convert,
  requireFiniteAmount,
  roundAmount,
  toCents,
} from '../common/money';
import { JournalEntryNumberingService } from './journal-entry-numbering.service';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';

/**
 * Context every posting carries.
 *
 * `actorUserId` is null only for entries the system generates on a schedule — depreciation,
 * recurring entries, automatic reversals — and those record the reason instead. It is not optional
 * for anything a person initiates: an entry with no author is not an auditable record.
 */
export interface PostingContext {
  actorUserId: string | null;
  /** Which subledger's period lock applies. The general ledger unless a subledger says otherwise. */
  module?: ModuleSlug;
  /** Short machine reason, recorded on the audit row for system-generated entries. */
  systemReason?: string;
}

const SYSTEM: PostingContext = { actorUserId: null, systemReason: 'system' };

@Injectable()
export class JournalEntriesService {
  private readonly logger = new Logger(JournalEntriesService.name);

  constructor(
    @InjectRepository(JournalEntry)
    private readonly journalEntryRepository: Repository<JournalEntry>,
    @InjectRepository(JournalEntryAttachment)
    private readonly attachmentRepository: Repository<JournalEntryAttachment>,
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly workflowsService: WorkflowsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly saasService: SaasService,
    private readonly numbering: JournalEntryNumberingService,
    private readonly auditTrail: AuditTrailService,
    /**
     * Optional so the cycle stays broken and so a caller constructing this service directly — the
     * integration suites do — is not forced to supply a control it is not exercising. When it is
     * absent the budget is simply not consulted, which is the behaviour every path had before.
     */
    @Optional()
    private readonly budgetControl?: BudgetControlService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Creating and posting
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Record an entry, then either post it or send it for approval.
   *
   * ## What changed
   *
   * This used to write a draft, ask the workflow engine whether approval was needed, and — when it
   * was not — build a *second, different* entry, post that, and delete the draft. The posted entry
   * therefore had a different id from the one the approval request, and anything else that had
   * seen the draft, referred to. Worse, the draft was written before any validation ran, so an
   * unbalanced entry, an entry against a closed period, or one touching a blocked account was
   * happily persisted and only rejected later, at approval time, by which point the approver had
   * already signed off on it.
   *
   * One row now. It is validated before it is written, and it changes status in place.
   */
  async create(
    createDto: CreateJournalEntryDto,
    organizationId: string,
    context: PostingContext,
  ): Promise<JournalEntry> {
    return this.dataSource.transaction(async (manager) => {
      // Metered inside the transaction that writes the entry, so a rolled-back post does not
      // consume quota and concurrent posts cannot all read the same pre-increment total.
      await this.saasService.enforceLimit(
        manager,
        organizationId,
        SaasResource.JOURNAL_ENTRIES,
      );

      const prepared = await this.prepare(manager, createDto, organizationId, context);

      const approvalRequest = await this.workflowsService.startApprovalProcess(
        organizationId,
        prepared.entry.id,
        DocumentTypeForApproval.JOURNAL_ENTRY,
        prepared.totalDebit,
      );

      if (!approvalRequest) {
        return this.markPosted(manager, prepared.entry, organizationId, context);
      }

      prepared.entry.status = JournalEntryStatus.PENDING_APPROVAL;
      await manager.save(prepared.entry);
      await this.recordAudit(
        manager,
        prepared.entry,
        organizationId,
        context,
        ActionType.CREATE,
        'submitted-for-approval',
      );
      this.logger.log(`Asiento ${prepared.entry.id} enviado para aprobación.`);
      return prepared.entry;
    });
  }

  /** Post on a caller-supplied manager, inside the caller's transaction. */
  public async createWithManager(
    manager: EntityManager,
    createDto: CreateJournalEntryDto,
    organizationId: string,
    context: PostingContext = SYSTEM,
  ): Promise<JournalEntry> {
    const prepared = await this.prepare(manager, createDto, organizationId, context);
    return this.markPosted(manager, prepared.entry, organizationId, context);
  }

  /**
   * Post on a caller-supplied `QueryRunner`.
   *
   * Kept because several subledgers hold a runner rather than a manager. It is the same path;
   * `createWithManager` is the one to prefer in new code.
   */
  public async createWithQueryRunner(
    queryRunner: QueryRunner,
    createDto: CreateJournalEntryDto,
    organizationId: string,
    context: PostingContext = SYSTEM,
  ): Promise<JournalEntry> {
    return this.createWithManager(
      queryRunner.manager,
      createDto,
      organizationId,
      context,
    );
  }

  /**
   * Validate a proposed entry completely and write it as a draft.
   *
   * Everything that can reject the entry happens here, before a row exists: the amounts are real
   * numbers, the entry balances exactly, the period is open for the posting module, every account
   * exists in this tenant and accepts postings, required dimensions are present, and a foreign
   * currency entry carries a usable rate.
   */
  private async prepare(
    manager: EntityManager,
    createDto: CreateJournalEntryDto,
    organizationId: string,
    context: PostingContext,
  ): Promise<{ entry: JournalEntry; totalDebit: number }> {
    const { lines, date, journalId, currencyCode, exchangeRate, ...entryData } =
      createDto;
    const entryDate = new Date(`${String(date).slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(entryDate.getTime())) {
      throw new BadRequestError(
        'VALIDATION.CREATE_JOURNAL_ENTRY.FECHA_DEBE_TENER_FORMATO_FECHA_ISO_8601_VALIDO',
      );
    }

    if (!lines || lines.length < 2) {
      throw new BadRequestError(
        'JOURNAL_ENTRIES.ASIENTO_CONTABLE_DEBE_TENER_MENOS_DOS_LINEAS',
      );
    }

    const defaultLedger = await manager.findOneBy(Ledger, {
      organizationId,
      isDefault: true,
    });
    if (!defaultLedger) {
      throw new BadRequestError(
        'JOURNAL_ENTRIES.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION',
      );
    }

    const journal = await manager.findOneBy(Journal, { id: journalId, organizationId });
    if (!journal) {
      throw new BadRequestError('JOURNAL_ENTRIES.DIARIO_NO_ENCONTRADO');
    }

    // ── Amounts ───────────────────────────────────────────────────────────────
    //
    // Read every figure through `requireFiniteAmount` first. The old code summed the raw DTO
    // values and compared with a 0.01 tolerance, so a total of NaN — which a `numeric` column read
    // as a string and concatenated produces — compared false against the threshold and sailed
    // through as balanced.
    let totalDebitCents = 0;
    let totalCreditCents = 0;
    const normalizedLines = lines.map((line, index) => {
      const debit = this.amount(line.debit, `lines[${index}].debit`);
      const credit = this.amount(line.credit, `lines[${index}].credit`);

      if (debit < 0 || credit < 0) {
        throw new BadRequestError(
          'VALIDATION.CREATE_JOURNAL_ENTRY.DEBITO_NO_PUEDE_NEGATIVO',
        );
      }
      if (debit > 0 && credit > 0) {
        throw new BadRequestError('JOURNAL_ENTRIES.LINEA_DEBITO_Y_CREDITO', {
          line: index + 1,
        });
      }
      if (debit === 0 && credit === 0) {
        throw new BadRequestError('JOURNAL_ENTRIES.LINEA_SIN_IMPORTE', {
          line: index + 1,
        });
      }

      totalDebitCents += toCents(debit);
      totalCreditCents += toCents(credit);
      return { ...line, debit, credit };
    });

    // Exact. Not "within a cent": a ledger that tolerates a cent per entry is a ledger that does
    // not balance, and nothing downstream was ever going to find the difference again.
    if (totalDebitCents !== totalCreditCents) {
      throw new BadRequestError(
        'JOURNAL_ENTRIES.ASIENTO_CONTABLE_NO_ESTA_BALANCEADO',
      );
    }

    // ── Period ────────────────────────────────────────────────────────────────
    const period = await resolvePostingPeriod(
      manager,
      organizationId,
      entryDate,
      context.module ?? ModuleSlug.GL,
    );

    // ── Accounts ──────────────────────────────────────────────────────────────
    //
    // No pessimistic lock. It used to take `SELECT … FOR UPDATE` on every account in the entry,
    // which serialised every posting that touched the cash account against every other, and
    // protected nothing: the balance it was guarding was written asynchronously by a worker long
    // after the lock was released. Balances are now derived from these rows, so the row insert is
    // the only thing that needs to be atomic, and it already is.
    const accountIds = [...new Set(normalizedLines.map((line) => line.accountId))];
    const accounts = await manager.find(Account, {
      where: { id: In(accountIds), organizationId },
    });
    if (accounts.length !== accountIds.length) {
      throw new BadRequestError(
        'JOURNAL_ENTRIES.MAS_CUENTAS_CONTABLES_NO_FUERON_ENCONTRADAS_ESTAN',
      );
    }
    const accountMap = new Map(accounts.map((account) => [account.id, account]));

    for (const account of accounts) {
      if (!account.isPostable) {
        throw new BadRequestError(
          'JOURNAL_ENTRIES.CUENTA_NO_PERMITE_CONTABILIZACION',
          { code: account.code, p2: this.accountLabel(account) },
        );
      }
      if (account.isBlockedForPosting) {
        throw new ForbiddenError(
          'JOURNAL_ENTRIES.CUENTA_ESTA_BLOQUEADA_NUEVAS_TRANSACCIONES',
          { code: account.code, p2: this.accountLabel(account) },
        );
      }
    }

    // ── Account locks for this period ────────────────────────────────────────
    //
    // Inside the transaction, on the accounts the entry actually resolved to.
    //
    // This was enforced only by `PeriodLockGuard`, which reads `body.lines[].accountId`. Two
    // consequences: every internal posting path — an invoice, a supplier bill, a collection,
    // depreciation, revaluation, the close, an intercompany transfer — bypassed it entirely,
    // because none of them arrives through an HTTP body with lines; and a document whose accounts
    // are derived server-side has no `lines[].accountId` in its body at all, so the guard found
    // nothing to check and returned true. An accountant who locked the cash account for March to
    // stop it moving during a reconciliation could still have it moved by every automatic posting
    // in the product.
    const locked = await manager
      .createQueryBuilder(AccountPeriodLock, 'lock')
      .innerJoinAndSelect('lock.account', 'account')
      .where('lock.organizationId = :organizationId', { organizationId })
      .andWhere('lock.periodId = :periodId', { periodId: period.id })
      .andWhere('lock.accountId IN (:...accountIds)', { accountIds })
      .andWhere('lock.isLocked = true')
      .getOne();

    if (locked) {
      throw new ForbiddenError('ACCOUNTING.CUENTA_ESTA_BLOQUEADA_TRANSACCIONES_PERIODO', {
        code: locked.account?.code ?? locked.accountId,
        name: period.name,
      });
    }

    await this.validateDimensionRules(manager, normalizedLines, accountMap);

    await this.enforceBudget(manager, organizationId, toIsoDate(entryDate), normalizedLines, accountMap, {
      ...context,
      entryType: entryData.entryType,
    });

    // ── Currency ──────────────────────────────────────────────────────────────
    const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
    const baseCurrency = settings?.baseCurrency || defaultLedger.currency || 'USD';
    const isForeignCurrency = Boolean(currencyCode && currencyCode !== baseCurrency);
    let rate = 1;
    if (isForeignCurrency) {
      rate = this.amount(exchangeRate, 'exchangeRate');
      if (rate <= 0) {
        throw new BadRequestError(
          'JOURNAL_ENTRIES.REQUIERE_TASA_CAMBIO_EXCHANGERATE_POSITIVA_TRANSACCIONES_MONEDA',
        );
      }
    }

    const entry = manager.create(JournalEntry, {
      ...entryData,
      date: entryDate,
      organizationId,
      journalId,
      currencyCode,
      exchangeRate: isForeignCurrency ? rate : undefined,
      ledgerId: defaultLedger.id,
      status: JournalEntryStatus.DRAFT,
      entryNumber: null,
      postedByUserId: null,
      postedAt: null,
      lines: [],
    });
    const savedEntry = await manager.save(entry);

    const mappingRules = await this.mappingRulesBySource(manager, organizationId);

    const finalLines: JournalEntryLine[] = [];
    let convertedDebitCents = 0;
    let convertedCreditCents = 0;

    for (const lineDto of normalizedLines) {
      const line = manager.create(JournalEntryLine, {
        accountId: lineDto.accountId,
        description: lineDto.description,
        dimensions: lineDto.dimensions,
        journalEntry: savedEntry,
        debit: lineDto.debit,
        credit: lineDto.credit,
        valuations: [],
      });

      if (isForeignCurrency) {
        // The document amount is kept as entered; the ledger amount is the conversion, rounded to
        // the minor unit here rather than left as an unrounded product for the column to truncate.
        line.foreignCurrencyDebit = lineDto.debit;
        line.foreignCurrencyCredit = lineDto.credit;
        line.debit = convert(lineDto.debit, rate);
        line.credit = convert(lineDto.credit, rate);
        line.exchangeRate = rate;
        line.currencyCode = currencyCode;
      }

      convertedDebitCents += toCents(line.debit);
      convertedCreditCents += toCents(line.credit);

      line.valuations = this.buildValuations(
        manager,
        lineDto,
        line,
        defaultLedger.id,
        isForeignCurrency ? rate : 1,
        mappingRules,
      );
      finalLines.push(line);
    }

    // Rounding each line independently can leave the converted entry a cent out even though the
    // document currency balanced exactly. That difference is real and has to be booked, not
    // ignored: absorbing it silently is how a multicurrency ledger drifts.
    if (convertedDebitCents !== convertedCreditCents) {
      const roundingAccountId = settings?.defaultForexGainLossAccountId;
      if (!roundingAccountId) {
        throw new BadRequestError(
          'JOURNAL_ENTRIES.DIFERENCIA_REDONDEO_SIN_CUENTA_CONFIGURADA',
        );
      }
      const differenceCents = convertedDebitCents - convertedCreditCents;
      const amount = roundAmount(Math.abs(differenceCents) / 100);
      const roundingLine = manager.create(JournalEntryLine, {
        accountId: roundingAccountId,
        description: 'Diferencia de redondeo por conversión de moneda',
        journalEntry: savedEntry,
        debit: differenceCents < 0 ? amount : 0,
        credit: differenceCents > 0 ? amount : 0,
        valuations: [],
      });
      roundingLine.valuations = [
        manager.create(JournalEntryLineValuation, {
          ledgerId: defaultLedger.id,
          debit: roundingLine.debit,
          credit: roundingLine.credit,
        }),
      ];
      finalLines.push(roundingLine);
    }

    savedEntry.lines = await manager.save(finalLines);
    return { entry: savedEntry, totalDebit: roundAmount(totalDebitCents / 100) };
  }

  /**
   * Move a prepared entry to POSTED: give it its place in the journal's series, stamp who and
   * when, and write the audit row — all inside the caller's transaction.
   */
  private async markPosted(
    manager: EntityManager,
    entry: JournalEntry,
    organizationId: string,
    context: PostingContext,
  ): Promise<JournalEntry> {
    const journal = await manager.findOneByOrFail(Journal, { id: entry.journalId });

    entry.entryNumber = await this.numbering.allocate(
      manager,
      organizationId,
      journal,
      entry.date instanceof Date ? entry.date : new Date(`${entry.date}T00:00:00Z`),
    );
    entry.status = JournalEntryStatus.POSTED;
    entry.postedByUserId = context.actorUserId;
    entry.postedAt = new Date();
    const posted = await manager.save(entry);

    await this.recordAudit(
      manager,
      posted,
      organizationId,
      context,
      ActionType.CREATE,
      'posted',
    );

    this.logger.log(
      `Asiento ${posted.entryNumber} contabilizado por ${context.actorUserId ?? 'el sistema'}.`,
    );
    return posted;
  }

  /**
   * Audit rows for accounting events are written *in the transaction*, not fired and forgotten.
   *
   * `AuditTrailService.record` deliberately does not await its own save so an HTTP request is not
   * held up by logging. For a ledger that trade is wrong: if the audit row is lost the posting it
   * describes still exists, and the book has an entry nobody is accountable for. Here the row and
   * the entry commit together or not at all.
   */
  private async recordAudit(
    manager: EntityManager,
    entry: JournalEntry,
    organizationId: string,
    context: PostingContext,
    action: ActionType,
    event: string,
  ): Promise<void> {
    await this.auditTrail.recordWithManager(manager, {
      userId: context.actorUserId,
      organizationId,
      entity: 'journal_entries',
      entityId: entry.id,
      actionType: action,
      newValue: {
        event,
        entryNumber: entry.entryNumber,
        status: entry.status,
        date: entry.date,
        journalId: entry.journalId,
        description: entry.description,
        systemReason: context.systemReason ?? null,
      },
    });
  }

  private amount(value: unknown, field: string): number {
    try {
      return roundAmount(requireFiniteAmount(value, field));
    } catch (error) {
      if (error instanceof MoneyError) {
        throw new BadRequestError('JOURNAL_ENTRIES.IMPORTE_NO_VALIDO', {
          field,
          detail: error.message,
        });
      }
      throw error;
    }
  }

  private accountLabel(account: Account): string {
    const name = account.name as Record<string, string> | string | undefined;
    if (typeof name === 'string') return name;
    if (!name) return account.code;
    return name['es'] ?? Object.values(name)[0] ?? account.code;
  }

  private async mappingRulesBySource(
    manager: EntityManager,
    organizationId: string,
  ): Promise<Map<string, LedgerMappingRule[]>> {
    const rules = await manager.find(LedgerMappingRule, { where: { organizationId } });
    const bySource = new Map<string, LedgerMappingRule[]>();
    for (const rule of rules) {
      const key = `${rule.sourceLedgerId}-${rule.sourceAccountId}`;
      const bucket = bySource.get(key);
      if (bucket) bucket.push(rule);
      else bySource.set(key, [rule]);
    }
    return bySource;
  }

  /**
   * The per-ledger amounts for one line.
   *
   * A line with no explicit valuations is valued in the default ledger at its ledger-currency
   * amount. Mapping rules then derive the other ledgers — the multi-GAAP mechanism — and a target
   * ledger that already has an explicit valuation is left alone rather than overwritten.
   */
  private buildValuations(
    manager: EntityManager,
    lineDto: CreateJournalEntryLineDto,
    line: JournalEntryLine,
    defaultLedgerId: string,
    rate: number,
    mappingRules: Map<string, LedgerMappingRule[]>,
  ): JournalEntryLineValuation[] {
    const source =
      lineDto.valuations && lineDto.valuations.length > 0
        ? lineDto.valuations.map((valuation) => ({
            ledgerId: valuation.ledgerId,
            debit: convert(this.amount(valuation.debit, 'valuation.debit'), rate),
            credit: convert(this.amount(valuation.credit, 'valuation.credit'), rate),
          }))
        : [{ ledgerId: defaultLedgerId, debit: line.debit, credit: line.credit }];

    const byLedger = new Map<string, JournalEntryLineValuation>();
    for (const valuation of source) {
      byLedger.set(
        valuation.ledgerId,
        manager.create(JournalEntryLineValuation, {
          ledgerId: valuation.ledgerId,
          debit: valuation.debit,
          credit: valuation.credit,
        }),
      );

      for (const rule of mappingRules.get(`${valuation.ledgerId}-${line.accountId}`) ?? []) {
        if (byLedger.has(rule.targetLedgerId)) continue;
        byLedger.set(
          rule.targetLedgerId,
          manager.create(JournalEntryLineValuation, {
            ledgerId: rule.targetLedgerId,
            debit: roundAmount(valuation.debit * Number(rule.multiplier)),
            credit: roundAmount(valuation.credit * Number(rule.multiplier)),
          }),
        );
      }
    }

    return [...byLedger.values()];
  }


  /**
   * Refuse a manual entry that would push a budgeted account past its line.
   *
   * ## Why the journal needs this and not only accounts payable
   *
   * `BudgetControlService.checkBudget` had exactly one caller: submitting a supplier bill for
   * approval. So the control stopped an expense that arrived as a supplier invoice and waved
   * through the identical expense typed straight into the journal — which is one screen away, and
   * is precisely what someone does when the first route refuses them. A control that any user can
   * step around is not a control; it is a speed bump for the honest.
   *
   * ## What it deliberately does not stop
   *
   * Only entries a person composed. A reversal *releases* budget rather than consuming it; a
   * closing entry, an opening balance and every system posting — depreciation, revaluation, the
   * result transfer, an intercompany leg — are consequences of transactions already approved, and
   * blocking one leaves the books half-written with no way forward. The budget is a control on
   * commitment, not on bookkeeping.
   */
  private async enforceBudget(
    manager: EntityManager,
    organizationId: string,
    entryDate: string,
    lines: { accountId: string; debit: number; credit: number; dimensions?: Record<string, string> }[],
    accountMap: Map<string, Account>,
    context: PostingContext & { entryType?: JournalEntryType },
  ): Promise<void> {
    if (!this.budgetControl) return;
    if (context.systemReason) return;
    if (context.entryType && context.entryType !== JournalEntryType.MANUAL) return;

    for (const line of lines) {
      const account = accountMap.get(line.accountId);
      if (!account) continue;

      // The movement in the account's natural sense. A credit to an expense account gives budget
      // back; only the consuming direction is checked.
      const creditNatured =
        account.type === AccountType.REVENUE ||
        account.type === AccountType.LIABILITY ||
        account.type === AccountType.EQUITY;
      const consumed = creditNatured ? line.credit - line.debit : line.debit - line.credit;
      if (consumed <= 0) continue;

      const check = await this.budgetControl.checkBudget(
        organizationId,
        line.accountId,
        consumed,
        entryDate,
        line.dimensions,
        manager,
      );

      if (check.isExceeded) {
        throw new ForbiddenError('JOURNAL_ENTRIES.CONTROL_PRESUPUESTARIO_FALLIDO', {
          detail: check.messageKey,
          ...(check.messageParams ?? {}),
        });
      }
    }
  }

  private async validateDimensionRules(
    manager: EntityManager,
    lines: CreateJournalEntryLineDto[],
    accountMap: Map<string, Account>,
  ): Promise<void> {
    const accountIds = [...new Set(lines.map((line) => line.accountId))];
    if (accountIds.length === 0) return;

    const rules = await manager.find(DimensionRule, {
      where: { accountId: In(accountIds), isRequired: true },
      relations: ['dimension'],
    });
    if (rules.length === 0) return;

    const byAccount = new Map<string, DimensionRule[]>();
    for (const rule of rules) {
      const bucket = byAccount.get(rule.accountId);
      if (bucket) bucket.push(rule);
      else byAccount.set(rule.accountId, [rule]);
    }

    for (const line of lines) {
      for (const rule of byAccount.get(line.accountId) ?? []) {
        const dimensionKey = rule.dimension.name;
        if (!line.dimensions?.[dimensionKey]) {
          const account = accountMap.get(line.accountId);
          throw new BadRequestError(
            'JOURNAL_ENTRIES.CUENTA_CONTABLE_REQUIERE_DIMENSION_OBLIGATORIA',
            {
              code: account?.code,
              p2: account ? this.accountLabel(account) : undefined,
              dimensionKey,
            },
          );
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Approval
  // ───────────────────────────────────────────────────────────────────────────

  async submitForApproval(
    journalEntryId: string,
    organizationId: string,
    context: PostingContext,
  ): Promise<JournalEntry> {
    return this.dataSource.transaction(async (manager) => {
      const entry = await manager.findOne(JournalEntry, {
        where: { id: journalEntryId, organizationId },
        relations: ['lines'],
      });
      if (!entry) throw new NotFoundError('JOURNAL_ENTRIES.ASIENTO_NO_ENCONTRADO');
      if (entry.status !== JournalEntryStatus.DRAFT) {
        throw new BadRequestError(
          'JOURNAL_ENTRIES.SOLO_ASIENTOS_BORRADOR_PUEDEN_SER_ENVIADOS_APROBACION',
        );
      }

      const totalDebit = roundAmount(
        entry.lines.reduce((total, line) => total + Number(line.debit), 0),
      );
      const approvalRequest = await this.workflowsService.startApprovalProcess(
        organizationId,
        entry.id,
        DocumentTypeForApproval.JOURNAL_ENTRY,
        totalDebit,
      );

      if (!approvalRequest) {
        return this.markPosted(manager, entry, organizationId, context);
      }

      entry.status = JournalEntryStatus.PENDING_APPROVAL;
      return manager.save(entry);
    });
  }

  /**
   * Post an entry whose approval has just been granted.
   *
   * ## Why this no longer swallows its errors
   *
   * The previous handler ran `dataSource.transaction(...)` with no `catch` at all inside an
   * `@OnEvent` handler, so a failure — a period closed between submission and approval, an account
   * blocked in the meantime — was reported to nobody: the approval said yes, the entry stayed
   * PENDING_APPROVAL forever, and no ledger row existed. An approved entry that cannot be posted is
   * an operational event someone has to see, so the failure is recorded on the entry itself and
   * announced, and the entry is left in a state that says what happened.
   */
  @OnEvent('approval.request.approved', { async: true })
  async handleApproval(payload: {
    documentId: string;
    documentType: string;
    organizationId: string;
    approvedByUserId?: string;
  }): Promise<void> {
    if (payload.documentType !== DocumentTypeForApproval.JOURNAL_ENTRY) return;

    try {
      const posted = await this.dataSource.transaction(async (manager) => {
        const entry = await manager.findOne(JournalEntry, {
          where: { id: payload.documentId, organizationId: payload.organizationId },
        });
        if (!entry || entry.status !== JournalEntryStatus.PENDING_APPROVAL) {
          this.logger.warn(
            `Asiento ${payload.documentId} no está pendiente de aprobación; se omite.`,
          );
          return null;
        }
        return this.markPosted(manager, entry, payload.organizationId, {
          actorUserId: payload.approvedByUserId ?? null,
          systemReason: 'approval-granted',
        });
      });

      if (posted) {
        this.eventEmitter.emit('journal-entry.posted', {
          entryId: posted.id,
          organizationId: payload.organizationId,
        });
      }
    } catch (error) {
      this.logger.error(
        `No se pudo contabilizar el asiento aprobado ${payload.documentId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      await this.journalEntryRepository.update(
        { id: payload.documentId, organizationId: payload.organizationId },
        {
          status: JournalEntryStatus.REJECTED,
          modificationReason: `Aprobado pero no contabilizable: ${(error as Error).message}`,
        },
      );
      this.eventEmitter.emit('journal-entry.posting-failed', {
        entryId: payload.documentId,
        organizationId: payload.organizationId,
        reason: (error as Error).message,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Reversal and modification
  // ───────────────────────────────────────────────────────────────────────────

  async reverse(
    id: string,
    organizationId: string,
    reverseDto: ReverseJournalEntryDto,
    context: PostingContext,
  ): Promise<JournalEntry> {
    return this.dataSource.transaction((manager) =>
      this.reverseWithin(id, organizationId, reverseDto, manager, context),
    );
  }

  /** Reverse on the caller's transaction — used by the close and by subledger voids. */
  async createSystemReversal(
    journalEntryId: string,
    organizationId: string,
    options: { reversalDate: string; reason: string },
    manager: EntityManager,
    context: PostingContext = SYSTEM,
  ): Promise<JournalEntry> {
    return this.reverseWithin(
      journalEntryId,
      organizationId,
      { reversalDate: options.reversalDate, reason: options.reason },
      manager,
      context,
    );
  }

  /**
   * The mirror image of an entry, posted as its own entry and linked back to the original.
   *
   * The reversal is built from the stored lines and their per-ledger valuations, so a multi-GAAP
   * entry reverses in every ledger it touched, not just the default one.
   */
  private async reverseWithin(
    id: string,
    organizationId: string,
    reverseDto: ReverseJournalEntryDto,
    manager: EntityManager,
    context: PostingContext,
  ): Promise<JournalEntry> {
    const original = await manager.findOne(JournalEntry, {
      where: { id, organizationId },
      relations: ['lines', 'lines.valuations'],
    });
    if (!original) {
      throw new NotFoundError('JOURNAL_ENTRIES.ASIENTO_REVERSAR_NO_ENCONTRADO');
    }
    if (original.status !== JournalEntryStatus.POSTED) {
      throw new BadRequestError('JOURNAL_ENTRIES.SOLO_PUEDEN_REVERSAR_ASIENTOS_CONTABILIZADOS');
    }
    if (original.isReversed) {
      throw new BadRequestError('JOURNAL_ENTRIES.ESTE_ASIENTO_YA_HA_SIDO_REVERSADO');
    }
    if (original.lines.some((line) => line.isReconciled)) {
      throw new ForbiddenError(
        'JOURNAL_ENTRIES.NO_PUEDE_REVERSAR_ASIENTO_CONTIENE_LINEAS_CONCILIADAS',
      );
    }

    const reversalDto: CreateJournalEntryDto = {
      date: reverseDto.reversalDate,
      description: `Reversión de ${original.entryNumber ?? original.id.slice(0, 8)}. Razón: ${reverseDto.reason}`,
      journalId: original.journalId,
      currencyCode: original.currencyCode,
      // The original's amounts are already in ledger currency; re-applying its rate would convert
      // them twice, so the reversal is posted as a base-currency entry.
      exchangeRate: undefined,
      lines: original.lines.map((line) => ({
        accountId: line.accountId,
        debit: Number(line.credit),
        credit: Number(line.debit),
        description: `Reversión: ${line.description || original.description}`,
        dimensions: line.dimensions,
        valuations: line.valuations?.map((valuation) => ({
          ledgerId: valuation.ledgerId,
          debit: Number(valuation.credit),
          credit: Number(valuation.debit),
        })),
      })),
    };

    const prepared = await this.prepare(manager, reversalDto, organizationId, {
      ...context,
      systemReason: context.systemReason ?? 'reversal',
    });
    prepared.entry.reversesEntryId = original.id;
    const reversal = await this.markPosted(
      manager,
      prepared.entry,
      organizationId,
      context,
    );

    // Targeted UPDATE rather than `save` on a stale in-memory copy. Saving the entity that was
    // loaded before the reversal ran writes back every column it holds, which is how `isReversed`
    // used to be reset to false by a later save in the same transaction.
    await manager.update(
      JournalEntry,
      { id: original.id, organizationId },
      { isReversed: true },
    );

    await this.recordAudit(
      manager,
      original,
      organizationId,
      context,
      ActionType.UPDATE,
      `reversed-by:${reversal.entryNumber}`,
    );
    return reversal;
  }

  /**
   * Reverse an accrual into the following period.
   *
   * Only entries explicitly flagged `reversesNextPeriod` qualify; the reversal is dated the first
   * day of the month after the entry, which is what "reverses next period" means on an accrual.
   */
  async createReversalEntry(
    id: string,
    organizationId: string,
    context: PostingContext = SYSTEM,
  ): Promise<JournalEntry> {
    const original = await this.journalEntryRepository.findOne({
      where: { id, organizationId },
    });
    if (!original) throw new NotFoundError('JOURNAL_ENTRIES.ASIENTO_NO_ENCONTRADO');
    if (!original.reversesNextPeriod) {
      throw new BadRequestError(
        'JOURNAL_ENTRIES.ESTE_ASIENTO_NO_ESTA_MARCADO_REVERSION_AUTOMATICA',
      );
    }

    const originalDate = new Date(
      `${String(original.date).slice(0, 10)}T00:00:00.000Z`,
    );
    const reversalDate = new Date(
      Date.UTC(originalDate.getUTCFullYear(), originalDate.getUTCMonth() + 1, 1),
    );

    return this.reverse(
      id,
      organizationId,
      {
        reversalDate: reversalDate.toISOString().slice(0, 10),
        reason: 'Reversión automática de ajuste de fin de período.',
      },
      { ...context, systemReason: 'scheduled-accrual-reversal' },
    );
  }

  /**
   * Correct a posted entry by reversing it and posting a replacement.
   *
   * A posted entry is never edited in place — the reversal and the replacement are both permanent
   * rows, and the original is marked MODIFIED and linked forward, so the correction is legible in
   * the book rather than hidden.
   */
  async update(
    id: string,
    organizationId: string,
    updateDto: UpdateJournalEntryDto,
    context: PostingContext,
  ): Promise<JournalEntry> {
    return this.dataSource.transaction(async (manager) => {
      const original = await manager.findOne(JournalEntry, {
        where: { id, organizationId },
        relations: ['lines'],
      });
      if (!original) {
        throw new NotFoundError('JOURNAL_ENTRIES.ASIENTO_ORIGINAL_NO_ENCONTRADO');
      }
      if (original.status !== JournalEntryStatus.POSTED) {
        throw new BadRequestError(
          'JOURNAL_ENTRIES.SOLO_PUEDEN_MODIFICAR_ASIENTOS_CONTABILIZADOS',
        );
      }
      if (original.lines.some((line) => line.isReconciled)) {
        throw new ForbiddenError(
          'JOURNAL_ENTRIES.NO_PUEDE_MODIFICAR_ASIENTO_CONTIENE_LINEAS_CONCILIADAS',
        );
      }

      await this.reverseWithin(
        id,
        organizationId,
        {
          reversalDate: updateDto.date,
          reason: `Modificación: ${updateDto.modificationReason}`,
        },
        manager,
        { ...context, systemReason: 'modification-reversal' },
      );

      const prepared = await this.prepare(manager, updateDto, organizationId, context);
      prepared.entry.modifiedFromEntryId = original.id;
      prepared.entry.modificationReason = updateDto.modificationReason;
      const replacement = await this.markPosted(
        manager,
        prepared.entry,
        organizationId,
        context,
      );

      await manager.update(
        JournalEntry,
        { id: original.id, organizationId },
        {
          status: JournalEntryStatus.MODIFIED,
          modifiedToEntryId: replacement.id,
          modificationReason: updateDto.modificationReason,
        },
      );

      this.logger.log(
        `Asiento ${original.entryNumber} modificado; reemplazado por ${replacement.entryNumber}.`,
      );
      return replacement;
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Reads
  // ───────────────────────────────────────────────────────────────────────────

  findAll(organizationId: string): Promise<JournalEntry[]> {
    return this.journalEntryRepository.find({
      where: { organizationId },
      order: { date: 'DESC', entryNumber: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string, organizationId: string): Promise<JournalEntry> {
    const entry = await this.journalEntryRepository.findOne({
      where: { id, organizationId },
      relations: [
        'lines',
        'lines.account',
        'reversesEntry',
        'reversedByEntry',
        'modifiedToEntry',
        'modifiedFromEntry',
        'attachments',
        'journal',
        'ledger',
      ],
    });
    if (!entry) {
      throw new NotFoundError('JOURNAL_ENTRIES.ASIENTO_CONTABLE_ID_NO_ENCONTRADO', {
        id,
      });
    }
    return entry;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Attachments
  // ───────────────────────────────────────────────────────────────────────────

  async addAttachment(
    journalEntryId: string,
    file: FastifyFile,
    organizationId: string,
    uploadedByUserId: string,
  ): Promise<JournalEntryAttachment> {
    await this.findOne(journalEntryId, organizationId);

    // Through the adapter, so a streamed upload (which arrives as a path, not a buffer) is stored
    // rather than silently written as an empty object.
    const storedFile = await this.storageService.upload(
      toUploadableFile(file),
      `journal-entries/${organizationId}`,
    );

    const attachment = this.attachmentRepository.create({
      journalEntryId,
      organizationId,
      fileName: file.originalname,
      fileType: file.mimetype,
      fileSize: storedFile.fileSize,
      storageKey: storedFile.storageKey,
      uploadedByUserId,
    });

    return this.attachmentRepository.save(attachment);
  }

  async getAttachment(
    attachmentId: string,
    organizationId: string,
  ): Promise<{
    metadata: JournalEntryAttachment;
    streamable: { stream: Readable; mimeType: string; fileSize: number };
  }> {
    const attachment = await this.attachmentRepository.findOneBy({
      id: attachmentId,
      organizationId,
    });
    if (!attachment) throw new NotFoundError('JOURNAL_ENTRIES.ADJUNTO_NO_ENCONTRADO');

    const { stream, fileSize, mimeType } = await this.storageService.getStream(
      attachment.storageKey,
    );
    return { metadata: attachment, streamable: { stream, mimeType, fileSize } };
  }

  async deleteAttachment(
    attachmentId: string,
    organizationId: string,
  ): Promise<void> {
    const attachment = await this.attachmentRepository.findOneBy({
      id: attachmentId,
      organizationId,
    });
    if (!attachment) throw new NotFoundError('JOURNAL_ENTRIES.ADJUNTO_NO_ENCONTRADO');

    await this.storageService.delete(attachment.storageKey);
    await this.attachmentRepository.remove(attachment);
  }
}
