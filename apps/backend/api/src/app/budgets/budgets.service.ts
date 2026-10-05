
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, EntityManager, In, Repository } from 'typeorm';
import { Budget } from './entities/budget.entity';
import { BudgetLineDto, CopyBudgetDto, CreateBudgetDto } from './dto/create-budget.dto';
import { BudgetVarianceQueryDto } from './dto/budget-variance.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { BudgetLine } from './entities/budget-line.entity';
import { BadRequestError, ConflictError, NotFoundError } from '../i18n/localized.exception';
import { Ledger } from '../accounting/entities/ledger.entity';
import { JournalEntryStatus } from '../journal-entries/entities/journal-entry.entity';
import { Account, AccountType } from '../chart-of-accounts/entities/account.entity';
import { endOfMonthIso, startOfMonthIso, toIsoDate } from '../common/dates';
import { roundAmount } from '../common/money';

/** A budget in the list: its month and what it adds up to. */
export interface BudgetSummary {
  id: string;
  name: string;
  period: string;
  updatedAt: Date;
  lineCount: number;
  total: number;
}

export interface BudgetVarianceLine {
  accountId: string;
  accountCode: string | null;
  accountName: unknown;
  accountType: AccountType | null;
  dimensions: Record<string, string>;
  budgetedAmount: number;
  actualAmount: number;
  difference: number;
  consumedRatio: number | null;
  /** What was budgeted for the line, month by month. */
  months: Record<string, number>;
}

export interface BudgetVarianceReport {
  period: { fromPeriod: string; toPeriod: string; startDate: string; endDate: string };
  ledger: { id: string; name: string; currency: string } | null;
  budgets: Array<{ id: string; name: string; period: string }>;
  lines: BudgetVarianceLine[];
  totals: { budgeted: number; actual: number; difference: number };
}

@Injectable()
export class BudgetsService {
  constructor(
    @InjectRepository(Budget)
    private budgetRepository: Repository<Budget>,
    @InjectRepository(JournalEntryLine)
    private journalEntryLineRepository: Repository<JournalEntryLine>,
    @InjectRepository(Ledger)
    private readonly ledgerRepository: Repository<Ledger>,
  ) {}

  async create(dto: CreateBudgetDto, organizationId: string): Promise<Budget> {
    const id = await this.budgetRepository.manager.transaction(async (manager) => {
      await this.assertPeriodFree(manager, organizationId, dto.period);
      await this.assertLines(manager, organizationId, dto.lines);
      const saved = await manager.save(
        manager.create(Budget, { name: dto.name, period: dto.period, organizationId, lines: [] }),
      );
      await this.writeLines(manager, saved.id, dto.lines);
      return saved.id;
    });
    return this.findOne(id, organizationId);
  }

  /** Every budget, newest month first, with what it adds up to. */
  async findAll(organizationId: string): Promise<BudgetSummary[]> {
    const rows = await this.budgetRepository
      .createQueryBuilder('budget')
      .leftJoin('budget.lines', 'line')
      .select([
        'budget.id AS "id"',
        'budget.name AS "name"',
        'budget.period AS "period"',
        'budget.updatedAt AS "updatedAt"',
      ])
      .addSelect('COUNT(line.id)', 'lineCount')
      .addSelect('COALESCE(SUM(line.amount), 0)', 'total')
      .where('budget.organizationId = :organizationId', { organizationId })
      .groupBy('budget.id')
      .orderBy('budget.period', 'DESC')
      .getRawMany<BudgetSummary>();
    return rows.map((row) => ({ ...row, lineCount: Number(row.lineCount), total: Number(row.total) }));
  }

  async findOne(id: string, organizationId: string): Promise<Budget> {
    const budget = await this.budgetRepository.findOne({
      where: { id, organizationId },
      relations: ['lines', 'lines.account'],
    });
    if (!budget) {
      throw new NotFoundError('budgets.budget_id_not_found', { id });
    }
    budget.lines.sort((a, b) => String(a.account?.code ?? '').localeCompare(String(b.account?.code ?? '')));
    return budget;
  }

  /**
   * Rename, move to another month, or replace the lines.
   *
   * The lines are replaced as a set, in one transaction: assigning a new array to the relation left
   * the old rows to TypeORM's orphan handling, which nulls their `budget_id` — a column that is NOT
   * NULL — so a second save of a budget failed outright.
   */
  async update(id: string, dto: UpdateBudgetDto, organizationId: string): Promise<Budget> {
    await this.budgetRepository.manager.transaction(async (manager) => {
      const budget = await manager.findOne(Budget, { where: { id, organizationId } });
      if (!budget) throw new NotFoundError('budgets.budget_id_not_found', { id });
      if (dto.period && dto.period !== budget.period) {
        await this.assertPeriodFree(manager, organizationId, dto.period);
      }
      if (dto.name !== undefined || dto.period !== undefined) {
        await manager.update(
          Budget,
          { id, organizationId },
          { ...(dto.name !== undefined ? { name: dto.name } : {}), ...(dto.period ? { period: dto.period } : {}) },
        );
      }
      if (dto.lines) {
        await this.assertLines(manager, organizationId, dto.lines);
        await manager.delete(BudgetLine, { budgetId: id });
        await this.writeLines(manager, id, dto.lines);
        // A change of lines is a change of the budget: its version and timestamp say so.
        await manager.increment(Budget, { id, organizationId }, 'version', 1);
      }
    });
    return this.findOne(id, organizationId);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const result = await this.budgetRepository.delete({ id, organizationId });
    if (result.affected === 0) {
      throw new NotFoundError('budgets.budget_id_not_found', { id });
    }
  }

  /**
   * Lay a budget down over other months — how a year is budgeted from one month — optionally
   * scaled. All or nothing: a month already budgeted is named and nothing is copied.
   */
  async copy(id: string, dto: CopyBudgetDto, organizationId: string): Promise<BudgetSummary[]> {
    const source = await this.findOne(id, organizationId);
    const periods = [...new Set(dto.periods)].filter((period) => period !== source.period);
    if (periods.length === 0) throw new BadRequestError('budgets.copy_needs_other_periods');
    const factor = dto.factor ?? 1;
    await this.budgetRepository.manager.transaction(async (manager) => {
      for (const period of periods) {
        await this.assertPeriodFree(manager, organizationId, period);
        const saved = await manager.save(
          manager.create(Budget, { name: source.name, period, organizationId, lines: [] }),
        );
        await this.writeLines(
          manager,
          saved.id,
          source.lines.map((line) => ({
            accountId: line.accountId,
            amount: roundAmount(Number(line.amount) * factor),
            dimensions: line.dimensions ?? {},
          })),
        );
      }
    });
    const all = await this.findAll(organizationId);
    return all.filter((row) => periods.includes(row.period));
  }

  /**
   * Budget against actuals over a run of months, across every budget in it, by account (and
   * dimension) — the variance analysis. Months without a budget contribute their actuals for the
   * budgeted accounts and nothing to the target, which is exactly what an over-spend looks like.
   */
  async variance(organizationId: string, query: BudgetVarianceQueryDto): Promise<BudgetVarianceReport> {
    if (query.fromPeriod > query.toPeriod) {
      throw new BadRequestError('budgets.invalid_date_range_start_date_later', {
        startDate: query.fromPeriod,
        endDate: query.toPeriod,
      });
    }
    const budgets = await this.budgetRepository.find({
      where: { organizationId, period: Between(query.fromPeriod, query.toPeriod) },
      relations: ['lines', 'lines.account'],
      order: { period: 'ASC' },
    });
    const startDate = startOfMonthIso(`${query.fromPeriod}-01`);
    const endDate = endOfMonthIso(`${query.toPeriod}-01`);
    const ledger = query.ledgerId
      ? await this.ledgerRepository.findOne({ where: { id: query.ledgerId, organizationId } })
      : await this.ledgerRepository.findOne({ where: { organizationId, isDefault: true } });

    type Bucket = { accountId: string; accountCode?: string; accountName?: unknown; accountType?: AccountType; dimensions: Record<string, string>; budgeted: number; months: Record<string, number> };
    const buckets = new Map<string, Bucket>();
    const key = (accountId: string, dimensions: Record<string, string> | null | undefined) =>
      `${accountId}-${JSON.stringify(dimensions ?? {})}`;
    for (const budget of budgets) {
      for (const line of budget.lines) {
        const k = key(line.accountId, line.dimensions);
        const bucket = buckets.get(k) ?? {
          accountId: line.accountId,
          accountCode: line.account?.code,
          accountName: line.account?.name,
          accountType: line.account?.type,
          dimensions: line.dimensions ?? {},
          budgeted: 0,
          months: {},
        };
        bucket.budgeted = roundAmount(bucket.budgeted + Number(line.amount));
        bucket.months[budget.period] = roundAmount((bucket.months[budget.period] ?? 0) + Number(line.amount));
        buckets.set(k, bucket);
      }
    }

    const accountIds = [...new Set([...buckets.values()].map((bucket) => bucket.accountId))];
    const actuals = new Map<string, number>();
    if (accountIds.length) {
      const q = this.journalEntryLineRepository
        .createQueryBuilder('line')
        .innerJoin('line.journalEntry', 'entry')
        .innerJoin('line.valuations', 'valuation')
        .where('entry.organizationId = :organizationId', { organizationId })
        .andWhere('entry.status = :posted', { posted: JournalEntryStatus.POSTED })
        .andWhere('entry.date BETWEEN :startDate AND :endDate', { startDate, endDate })
        .andWhere('line.accountId IN (:...accountIds)', { accountIds });
      if (ledger) q.andWhere('valuation.ledgerId = :ledgerId', { ledgerId: ledger.id });
      const rows = await q
        .select([
          'line.accountId AS "accountId"',
          'line.dimensions AS "dimensions"',
          'COALESCE(SUM(valuation.debit - valuation.credit), 0) AS "amount"',
        ])
        .groupBy('line.accountId')
        .addGroupBy('line.dimensions')
        .getRawMany<{ accountId: string; dimensions: Record<string, string> | null; amount: string }>();
      for (const row of rows) actuals.set(key(row.accountId, row.dimensions), Number(row.amount));
    }

    let budgeted = 0;
    let actual = 0;
    const lines = [...buckets.values()]
      .sort((a, b) => String(a.accountCode ?? '').localeCompare(String(b.accountCode ?? '')))
      .map((bucket) => {
        const signed = actuals.get(key(bucket.accountId, bucket.dimensions)) ?? 0;
        const creditNatured =
          bucket.accountType === AccountType.REVENUE ||
          bucket.accountType === AccountType.LIABILITY ||
          bucket.accountType === AccountType.EQUITY;
        const actualAmount = roundAmount(creditNatured ? -signed : signed);
        budgeted = roundAmount(budgeted + bucket.budgeted);
        actual = roundAmount(actual + actualAmount);
        return {
          accountId: bucket.accountId,
          accountCode: bucket.accountCode ?? null,
          accountName: bucket.accountName ?? null,
          accountType: bucket.accountType ?? null,
          dimensions: bucket.dimensions,
          budgetedAmount: bucket.budgeted,
          actualAmount,
          difference: roundAmount(bucket.budgeted - actualAmount),
          consumedRatio: bucket.budgeted === 0 ? null : roundAmount(actualAmount / bucket.budgeted, 4),
          months: bucket.months,
        };
      });

    return {
      period: { fromPeriod: query.fromPeriod, toPeriod: query.toPeriod, startDate, endDate },
      ledger: ledger ? { id: ledger.id, name: ledger.name, currency: ledger.currency } : null,
      budgets: budgets.map((budget) => ({ id: budget.id, name: budget.name, period: budget.period })),
      lines,
      totals: { budgeted, actual, difference: roundAmount(budgeted - actual) },
    };
  }

  /** One budget per month; said in words rather than as a unique-key violation. */
  private async assertPeriodFree(manager: EntityManager, organizationId: string, period: string): Promise<void> {
    const taken = await manager.findOne(Budget, { where: { organizationId, period }, select: ['id'] });
    if (taken) throw new ConflictError('budgets.period_already_budgeted', { period });
  }

  /** Every account exists in this company and takes postings; no account × dimensions twice. */
  private async assertLines(manager: EntityManager, organizationId: string, lines: BudgetLineDto[]): Promise<void> {
    const seen = new Set<string>();
    for (const line of lines) {
      const k = `${line.accountId}-${JSON.stringify(line.dimensions ?? {})}`;
      if (seen.has(k)) throw new BadRequestError('budgets.duplicate_line');
      seen.add(k);
    }
    const ids = [...new Set(lines.map((line) => line.accountId))];
    if (ids.length === 0) return;
    const accounts = await manager.find(Account, { where: { organizationId, id: In(ids) }, select: ['id', 'code', 'isPostable', 'isActive'] });
    if (accounts.length !== ids.length) throw new BadRequestError('budgets.account_not_found');
    const header = accounts.find((account) => !account.isPostable || !account.isActive);
    if (header) throw new BadRequestError('budgets.account_not_postable', { code: header.code });
  }

  private async writeLines(manager: EntityManager, budgetId: string, lines: BudgetLineDto[]): Promise<void> {
    if (lines.length === 0) return;
    await manager.insert(
      BudgetLine,
      lines.map((line) => ({
        budgetId,
        accountId: line.accountId,
        amount: roundAmount(Number(line.amount)),
        dimensions: line.dimensions ?? {},
      })),
    );
  }

  /**
   * Budget against actuals, line by line.
   *
   * ## It had no route
   *
   * This method existed and nothing called it: `BudgetsController` exposed create, list, read,
   * update and delete, and no comparison. A budget you cannot compare against reality is a list of
   * numbers, and the comparison is the only reason to keep one.
   *
   * ## And it summed the wrong rows
   *
   * No `status` filter, so drafts and annulled entries counted as spend; and `line.debit` rather
   * than the per-ledger valuation, so a multi-GAAP tenant compared its budget against whichever
   * book the line happened to carry. Both are the same defects `checkBudget` had, which is what
   * happens when the same query is written twice.
   */
  async getBudgetVsActualReport(
    budgetId: string,
    organizationId: string,
    range?: { startDate?: Date | string; endDate?: Date | string; ledgerId?: string },
  ) {
    const budget = await this.findOne(budgetId, organizationId);
    const accountIds = [...new Set(budget.lines.map((line) => line.accountId))];

    // Defaults to the budget's own month. Asking a caller to restate the period a budget already
    // names is how the two come to disagree.
    const startDate = range?.startDate
      ? toIsoDate(range.startDate)
      : startOfMonthIso(`${budget.period}-01`);
    const endDate = range?.endDate
      ? toIsoDate(range.endDate)
      : endOfMonthIso(`${budget.period}-01`);

    if (startDate > endDate) {
      throw new BadRequestError('budgets.invalid_date_range_start_date_later', { startDate, endDate });
    }

    const ledger = range?.ledgerId
      ? await this.ledgerRepository.findOne({ where: { id: range.ledgerId, organizationId } })
      : await this.ledgerRepository.findOne({ where: { organizationId, isDefault: true } });

    if (accountIds.length === 0) {
      return {
        budget: { id: budget.id, name: budget.name, period: budget.period },
        period: { startDate, endDate },
        ledger: ledger ? { id: ledger.id, name: ledger.name, currency: ledger.currency } : null,
        lines: [],
        totals: { budgeted: 0, actual: 0, difference: 0 },
      };
    }

    const query = this.journalEntryLineRepository
      .createQueryBuilder('line')
      .innerJoin('line.journalEntry', 'entry')
      .innerJoin('line.valuations', 'valuation')
      .where('entry.organizationId = :organizationId', { organizationId })
      .andWhere('entry.status = :posted', { posted: JournalEntryStatus.POSTED })
      .andWhere('entry.date BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('line.accountId IN (:...accountIds)', { accountIds });

    if (ledger) {
      query.andWhere('valuation.ledgerId = :ledgerId', { ledgerId: ledger.id });
    }

    const actuals = await query
      .select([
        'line.accountId AS "accountId"',
        'line.dimensions AS "dimensions"',
        'COALESCE(SUM(valuation.debit - valuation.credit), 0) AS "actualAmount"',
      ])
      .groupBy('line.accountId')
      .addGroupBy('line.dimensions')
      .getRawMany<{ accountId: string; dimensions: unknown; actualAmount: string }>();

    const actualsMap = new Map<string, number>();
    for (const row of actuals) {
      const key = `${row.accountId}-${JSON.stringify(row.dimensions || {})}`;
      actualsMap.set(key, Number(row.actualAmount));
    }

    let totalBudgeted = 0;
    let totalActual = 0;

    const lines = budget.lines.map((line) => {
      const key = `${line.accountId}-${JSON.stringify(line.dimensions || {})}`;
      const signed = actualsMap.get(key) ?? 0;
      // The account's natural sense, so a revenue budget reads positive against a positive target
      // instead of comparing a negative actual with it.
      const creditNatured =
        line.account?.type === AccountType.REVENUE ||
        line.account?.type === AccountType.LIABILITY ||
        line.account?.type === AccountType.EQUITY;
      const actualAmount = roundAmount(creditNatured ? -signed : signed);

      totalBudgeted = roundAmount(totalBudgeted + Number(line.amount));
      totalActual = roundAmount(totalActual + actualAmount);

      return {
        id: line.id,
        accountId: line.accountId,
        accountCode: line.account?.code,
        accountName: line.account?.name,
        dimensions: line.dimensions ?? null,
        budgetedAmount: Number(line.amount),
        actualAmount,
        difference: roundAmount(Number(line.amount) - actualAmount),
        /** Share of the line consumed, or null when nothing was budgeted for it. */
        consumedRatio:
          Number(line.amount) === 0 ? null : roundAmount(actualAmount / Number(line.amount), 4),
      };
    });

    return {
      budget: { id: budget.id, name: budget.name, period: budget.period },
      period: { startDate, endDate },
      ledger: ledger ? { id: ledger.id, name: ledger.name, currency: ledger.currency } : null,
      lines,
      totals: {
        budgeted: totalBudgeted,
        actual: totalActual,
        difference: roundAmount(totalBudgeted - totalActual),
      },
    };
  }
}
