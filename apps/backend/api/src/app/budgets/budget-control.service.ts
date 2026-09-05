import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Budget } from './entities/budget.entity';
import { BudgetLine } from './entities/budget-line.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { JournalEntryStatus } from '../journal-entries/entities/journal-entry.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { AccountType } from '../chart-of-accounts/entities/account.entity';
import { LocalizedMessage } from '../i18n/localized-message';
import { endOfMonthIso, startOfMonthIso, toIsoDate, toIsoMonth } from '../common/dates';
import { roundAmount } from '../common/money';

export interface BudgetCheckResult extends LocalizedMessage {
  isExceeded: boolean;
  budgetName?: string;
  budgetedAmount?: number;
  actualAmount?: number;
  /** Budget less actual: what is left before the line is exhausted. */
  variance?: number;
}

/**
 * Whether a posting fits inside the budget line that covers it.
 *
 * ## Four things it was getting wrong
 *
 * 1. **It counted unposted entries.** The actuals query summed `journal_entry_lines` with no join
 *    condition on the entry's status, so a draft or an annulled entry consumed budget exactly like
 *    a posted one. A user could exhaust a department's budget with entries that were never
 *    approved, and reversing an annulled entry did not give the budget back — the annulled entry
 *    and its reversal were both counted.
 * 2. **It read the wrong month.** The budget key came from `transactionDate.getFullYear()` and
 *    `getMonth()`, and the range from date-fns `startOfMonth`/`endOfMonth` — all local-time. A
 *    `date` column arrives as midnight UTC, so on a server west of Greenwich the first of the month
 *    read as the last day of the previous one: the check compared a March posting against the
 *    February budget, and the March budget was silently never consulted for that day.
 * 3. **It ignored per-ledger valuations.** It summed `line.debit`/`line.credit`, which are the
 *    primary ledger's figures. A tenant whose IFRS book values a cost differently was budgeted
 *    against whichever book the line happened to carry.
 * 4. **It assumed every budget is an expense budget.** `SUM(debit − credit)` is the natural sense
 *    of a debit account and the *inverse* of a revenue account's, so a revenue budget compared a
 *    negative actual against a positive target and could never be exceeded.
 */
@Injectable()
export class BudgetControlService {
  private readonly logger = new Logger(BudgetControlService.name);

  constructor(
    @InjectRepository(Budget)
    private readonly budgetRepository: Repository<Budget>,
    @InjectRepository(JournalEntryLine)
    private readonly journalEntryLineRepository: Repository<JournalEntryLine>,
    @InjectRepository(Ledger)
    private readonly ledgerRepository: Repository<Ledger>,
  ) {}

  /**
   * @param manager when the caller is inside a transaction — a posting is — so the check sees the
   *   entries that transaction has already written and cannot be raced by a concurrent posting
   *   committing between the check and the write.
   */
  async checkBudget(
    organizationId: string,
    accountId: string,
    amount: number,
    transactionDate: Date | string,
    dimensions?: Record<string, string>,
    manager?: EntityManager,
  ): Promise<BudgetCheckResult> {
    const em = manager ?? this.budgetRepository.manager;
    const date = toIsoDate(transactionDate);
    // UTC throughout. `2026-03-01` is March, on every server, in every timezone.
    const periodKey = toIsoMonth(date);

    const budget = await em.findOne(Budget, {
      where: { organizationId, period: periodKey },
      relations: ['lines', 'lines.account'],
    });

    if (!budget) {
      return {
        isExceeded: false,
        messageKey: 'BUDGETS.NO_ENCONTRO_PRESUPUESTO_ACTIVO_PARA_PERIODO_ACTUAL',
      };
    }

    // The dimensional line first, then the account-level one. A cost booked to a cost centre is
    // controlled by that centre's line when it has one, and by the account's overall line when it
    // does not.
    const budgetLine =
      this.findMatchingBudgetLine(budget.lines, accountId, dimensions) ??
      this.findMatchingBudgetLine(budget.lines, accountId);

    if (!budgetLine) {
      return {
        isExceeded: false,
        messageKey: 'BUDGETS.CUENTA_SUS_DIMENSIONES_NO_ESTAN_PRESUPUESTADAS',
      };
    }

    const ledger = await em.findOne(Ledger, {
      where: { organizationId, isDefault: true },
    });
    const start = startOfMonthIso(date);
    const end = endOfMonthIso(date);

    const query = em
      .createQueryBuilder(JournalEntryLine, 'line')
      .innerJoin('line.journalEntry', 'entry')
      .innerJoin('line.valuations', 'valuation')
      .where('entry.organizationId = :organizationId', { organizationId })
      // Only what is actually in the books. A draft is a proposal, not a commitment — commitment
      // accounting against purchase orders is a separate control with its own ledger.
      .andWhere('entry.status = :posted', { posted: JournalEntryStatus.POSTED })
      .andWhere('entry.date BETWEEN :start AND :end', { start, end })
      .andWhere('line.accountId = :accountId', { accountId });

    if (ledger) {
      query.andWhere('valuation.ledgerId = :ledgerId', { ledgerId: ledger.id });
    }

    if (budgetLine.dimensions && Object.keys(budgetLine.dimensions).length > 0) {
      Object.entries(budgetLine.dimensions).forEach(([key, value], index) => {
        // Parameterised per dimension: two dimensions on one line used the same `:dimKey` and
        // `:dimValue` placeholders, so the second overwrote the first and the query filtered on
        // one dimension while claiming to filter on both.
        query.andWhere(`line.dimensions ->> :dimKey${index} = :dimValue${index}`, {
          [`dimKey${index}`]: key,
          [`dimValue${index}`]: value,
        });
      });
    } else {
      // Parenthesised. Without the brackets the `OR` binds across every preceding `AND`, so the
      // whole tenant and status filter fell away for any line with empty dimensions.
      query.andWhere(`(line.dimensions IS NULL OR line.dimensions::text = '{}')`);
    }

    const raw = await query
      .select('COALESCE(SUM(valuation.debit - valuation.credit), 0)', 'actual')
      .getRawOne<{ actual: string }>();

    const signed = Number(raw?.actual ?? 0);
    // In the account's natural sense: an expense budget counts debits, a revenue budget counts
    // credits. Comparing a credit-natured account's `debit − credit` against a positive target
    // meant a revenue budget could never be reported as met, let alone exceeded.
    const natural = this.isCreditNatured(budgetLine) ? -signed : signed;

    const currentActual = roundAmount(natural);
    const budgetedAmount = Number(budgetLine.amount);
    const projected = roundAmount(currentActual + amount);

    if (projected > budgetedAmount) {
      return {
        isExceeded: true,
        messageKey: 'BUDGETS.AMOUNT_EXCEEDS_BUDGET',
        // The amounts stay numbers: the catalogue formats them in the reader's locale and in the
        // books' currency. `toFixed(2)` produced "1234.50" for a reader whose decimal separator
        // is a comma and whose thousands separator is a dot.
        messageParams: {
          amount,
          budgeted: budgetedAmount,
          account: budgetLine.account?.code || budgetLine.accountId,
          actual: currentActual,
        },
        budgetName: budget.name,
        budgetedAmount,
        actualAmount: currentActual,
        variance: roundAmount(budgetedAmount - currentActual),
      };
    }

    return {
      isExceeded: false,
      messageKey: 'BUDGETS.DENTRO_PRESUPUESTO',
      budgetName: budget.name,
      budgetedAmount,
      actualAmount: currentActual,
      variance: roundAmount(budgetedAmount - currentActual),
    };
  }

  /** Revenue and liability budgets are read in credit sense; everything else in debit sense. */
  private isCreditNatured(line: BudgetLine): boolean {
    const type = line.account?.type;
    return type === AccountType.REVENUE || type === AccountType.LIABILITY || type === AccountType.EQUITY;
  }

  private findMatchingBudgetLine(
    lines: BudgetLine[],
    accountId: string,
    dimensions?: Record<string, string>,
  ): BudgetLine | undefined {
    if (!dimensions || Object.keys(dimensions).length === 0) {
      return lines.find(
        (line) =>
          line.accountId === accountId &&
          (!line.dimensions || Object.keys(line.dimensions).length === 0),
      );
    }

    return lines.find((line) => {
      if (line.accountId !== accountId || !line.dimensions) return false;
      const lineKeys = Object.keys(line.dimensions);
      if (lineKeys.length !== Object.keys(dimensions).length) return false;
      return lineKeys.every((key) => dimensions[key] === line.dimensions?.[key]);
    });
  }
}
