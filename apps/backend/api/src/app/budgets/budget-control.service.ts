import { LEDGER_STATUS_VALUES } from '../contracts/accounting/ledger-statuses.contract';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Budget } from './entities/budget.entity';
import { BudgetLine } from './entities/budget-line.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { AccountType } from '../chart-of-accounts/entities/account.entity';
import { LocalizedMessage } from '../i18n/localized-message';
import type { BudgetControlMode } from '../contracts/accounting/budget-control.contract';
import {
  BudgetControlRegistry,
  budgetLimitsPosting,
  type BudgetControlSource,
  type BudgetDecision,
  type BudgetPosting,
} from '../contracts/budget-control/budget-control.contract';
import { endOfMonthIso, startOfMonthIso, toIsoDate, toIsoMonth } from '../common/dates';
import { roundAmount } from '../common/money';

export interface BudgetCheckResult extends LocalizedMessage {
  /** Past the line by more than the company's tolerance — whatever the control then does about it. */
  isExceeded: boolean;
  /** What the company's control does with an exceeded line; only meaningful when `isExceeded`. */
  enforcement?: Exclude<BudgetControlMode, 'none'>;
  budgetName?: string;
  /** `YYYY-MM`: the month of the budget that covers the posting. */
  period?: string;
  accountCode?: string | null;
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
export class BudgetControlService implements BudgetControlSource, OnModuleInit {
  private readonly logger = new Logger(BudgetControlService.name);

  constructor(
    @InjectRepository(Budget)
    private readonly budgetRepository: Repository<Budget>,
    @InjectRepository(JournalEntryLine)
    private readonly journalEntryLineRepository: Repository<JournalEntryLine>,
    @InjectRepository(Ledger)
    private readonly ledgerRepository: Repository<Ledger>,
    private readonly registry: BudgetControlRegistry,
  ) {}

  /** The journal and accounts payable reach budget control through the contract, not this class. */
  onModuleInit(): void {
    this.registry.provide(this);
  }

  /**
   * The decision for one posting: within its line (plus the company's tolerance), past it under a
   * control that warns, or past it under a control that refuses. Acting on it — refusing, or
   * publishing the warning after the commit — is `BudgetControlRegistry`'s, the same for every caller.
   */
  async decide(manager: EntityManager, organizationId: string, posting: BudgetPosting): Promise<BudgetDecision> {
    const check = await this.checkBudget(organizationId, posting.accountId, posting.amount, posting.date, posting.dimensions, manager);
    if (!check.isExceeded) return { outcome: 'within' };
    if (check.enforcement === 'block') {
      return { outcome: 'block', messageKey: check.messageKey, params: check.messageParams ?? {} };
    }
    return {
      outcome: 'warn',
      exceeded: {
        budgetName: check.budgetName ?? '',
        period: check.period ?? '',
        accountId: posting.accountId,
        accountCode: check.accountCode ?? null,
        budgeted: check.budgetedAmount ?? 0,
        actual: roundAmount((check.actualAmount ?? 0) + posting.amount),
        amount: posting.amount,
      },
    };
  }

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
        messageKey: 'budgets.no_active_budget_found_current_period',
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
        messageKey: 'budgets.account_dimensions_not_budgeted',
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
      .andWhere('entry.status IN (:...ledgerStatuses)', { ledgerStatuses: LEDGER_STATUS_VALUES })
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

    // A budget on revenue, a liability or equity is a target, not a ceiling: selling more than
    // budgeted is the good outcome, and refusing to book the sale was the control turned upside
    // down (FINB-20). It is measured — how far it is from being met — and never refused.
    if (!budgetLimitsPosting(budgetLine.account?.type)) {
      return {
        isExceeded: false,
        messageKey: 'budgets.target_not_a_limit',
        budgetName: budget.name,
        budgetedAmount,
        actualAmount: currentActual,
        variance: roundAmount(budgetedAmount - currentActual),
      };
    }

    const projected = roundAmount(currentActual + amount);
    const control = await this.controlOf(em, organizationId);
    // The line plus the company's tolerance; nothing at all when the company only measures.
    const limit = roundAmount(budgetedAmount * (1 + control.toleranceBps / 10_000));

    if (control.mode !== 'none' && projected > limit) {
      return {
        isExceeded: true,
        enforcement: control.mode,
        period: periodKey,
        accountCode: budgetLine.account?.code ?? null,
        messageKey: 'budgets.amount_exceeds_budget',
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
      messageKey: 'budgets.within_budget',
      budgetName: budget.name,
      period: periodKey,
      accountCode: budgetLine.account?.code ?? null,
      budgetedAmount,
      actualAmount: currentActual,
      variance: roundAmount(budgetedAmount - currentActual),
    };
  }

  /**
   * The company's budget control: its mode and tolerance. Read as columns, not through the
   * settings entity, which belongs to another module. A company with no settings row yet is
   * controlled the way the product always controlled it: blocked, no tolerance.
   */
  private async controlOf(
    em: EntityManager,
    organizationId: string,
  ): Promise<{ mode: BudgetControlMode; toleranceBps: number }> {
    const [row]: Array<{ mode: BudgetControlMode; tolerance_bps: number }> = await em.query(
      `SELECT budget_control_mode AS mode, budget_tolerance_bps AS tolerance_bps
         FROM organization_settings WHERE organization_id = $1`,
      [organizationId],
    );
    return { mode: row?.mode ?? 'block', toleranceBps: Math.max(0, Number(row?.tolerance_bps ?? 0)) };
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
