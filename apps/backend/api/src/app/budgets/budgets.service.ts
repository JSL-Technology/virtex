
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Budget } from './entities/budget.entity';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { BudgetLine } from './entities/budget-line.entity';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { Ledger } from '../accounting/entities/ledger.entity';
import { JournalEntryStatus } from '../journal-entries/entities/journal-entry.entity';
import { AccountType } from '../chart-of-accounts/entities/account.entity';
import { endOfMonthIso, startOfMonthIso, toIsoDate } from '../common/dates';
import { roundAmount } from '../common/money';

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

  create(createBudgetDto: CreateBudgetDto, organizationId: string): Promise<Budget> {
    const { lines, ...budgetData } = createBudgetDto;
    const budgetLines = lines.map(lineDto => {
        const line = new BudgetLine();

        line.accountId = lineDto.accountId;
        line.amount = lineDto.amount;
        line.dimensions = lineDto.dimensions ?? {};
        return line;
    });

    const newBudget = this.budgetRepository.create({ 
        ...budgetData, 
        organizationId,
        lines: budgetLines 
    });
    return this.budgetRepository.save(newBudget);
  }

  findAll(organizationId: string): Promise<Budget[]> {
    return this.budgetRepository.find({ where: { organizationId } });
  }

  async findOne(id: string, organizationId: string): Promise<Budget> {
    const budget = await this.budgetRepository.findOne({ 
        where: { id, organizationId },
        relations: ['lines', 'lines.account'],
    });
    if (!budget) {
      throw new NotFoundError('BUDGETS.PRESUPUESTO_ID_NO_ENCONTRADO', { id });
    }
    return budget;
  }

  async update(id: string, updateBudgetDto: UpdateBudgetDto, organizationId: string): Promise<Budget> {
      const budget = await this.findOne(id, organizationId);
      const { lines, ...budgetData } = updateBudgetDto;
      
      Object.assign(budget, budgetData);

      if (lines) {
          budget.lines = lines.map(lineDto => {
              const line = new BudgetLine();

              line.accountId = lineDto.accountId;
              line.amount = lineDto.amount;
              line.dimensions = lineDto.dimensions ?? {};
              return line;
          });
      }
      
      return this.budgetRepository.save(budget);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const result = await this.budgetRepository.delete({ id, organizationId });
    if (result.affected === 0) {
        throw new NotFoundError('BUDGETS.PRESUPUESTO_ID_NO_ENCONTRADO', { id });
    }
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
      throw new BadRequestError('BUDGETS.RANGO_FECHAS_INVALIDO', { startDate, endDate });
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
