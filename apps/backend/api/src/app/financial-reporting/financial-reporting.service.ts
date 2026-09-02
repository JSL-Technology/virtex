import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Account } from '../chart-of-accounts/entities/account.entity';
import {
  AccountCategory,
  AccountRole,
  AccountType,
} from '../chart-of-accounts/enums/account-enums';
import { Ledger } from '../accounting/entities/ledger.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import {
  AccountBalancesService,
  previousDay,
  toIsoDate,
  toNaturalAmount,
} from '../chart-of-accounts/account-balances.service';
import { roundAmount, sumAmounts, toCents } from '../common/money';

export type DimensionFilters = Record<string, string>;

export interface ReportAccountLine {
  accountId: string;
  code: string;
  name: Record<string, string> | string;
  type: AccountType;
  category: AccountCategory;
  /** Presented in the account's natural sense: revenue and liabilities read positive. */
  amount: number;
}

export interface ReportSection {
  category: AccountCategory | 'CASH';
  accounts: ReportAccountLine[];
  subtotal: number;
}

export interface LedgerRef {
  id: string;
  name: string;
  currency: string;
}

export interface BalanceSheetReport {
  asOfDate: string;
  filters: DimensionFilters;
  ledger: LedgerRef;
  assets: { sections: ReportSection[]; total: number };
  liabilities: { sections: ReportSection[]; total: number };
  equity: {
    sections: ReportSection[];
    /** Result of the current fiscal year that no close has moved to retained earnings yet. */
    unclosedResult: number;
    total: number;
  };
  totalLiabilitiesAndEquity: number;
  /**
   * Whether assets equal liabilities plus equity.
   *
   * Reported rather than assumed. A balance sheet that does not balance is the single most
   * important thing a reader can be told about it, and the previous implementation had no notion
   * of a total at all, let alone of the equation holding.
   */
  isBalanced: boolean;
  outOfBalanceBy: number;
}

export interface IncomeStatementReport {
  period: { startDate: string; endDate: string };
  filters: DimensionFilters;
  ledger: LedgerRef;
  revenue: { sections: ReportSection[]; total: number };
  costOfSales: { accounts: ReportAccountLine[]; total: number };
  grossProfit: number;
  operatingExpenses: { accounts: ReportAccountLine[]; total: number };
  operatingIncome: number;
  nonOperating: { accounts: ReportAccountLine[]; total: number };
  netIncome: number;
}

export interface TrialBalanceReport {
  period: { startDate: string; endDate: string };
  ledger: LedgerRef;
  rows: {
    accountId: string;
    code: string;
    name: Record<string, string> | string;
    type: AccountType;
    openingDebit: number;
    openingCredit: number;
    periodDebit: number;
    periodCredit: number;
    closingDebit: number;
    closingCredit: number;
  }[];
  totals: {
    openingDebit: number;
    openingCredit: number;
    periodDebit: number;
    periodCredit: number;
    closingDebit: number;
    closingCredit: number;
  };
  /** Debits equal credits in all three column pairs. If false the ledger itself is broken. */
  isBalanced: boolean;
}

export interface CashFlowStatementReport {
  period: { startDate: string; endDate: string };
  ledger: LedgerRef;
  openingCash: number;
  operating: {
    netIncome: number;
    nonCashAdjustments: { accountId: string; code: string; amount: number }[];
    workingCapitalChanges: { accountId: string; code: string; amount: number }[];
    total: number;
  };
  investing: { movements: { accountId: string; code: string; amount: number }[]; total: number };
  financing: { movements: { accountId: string; code: string; amount: number }[]; total: number };
  netChangeInCash: number;
  closingCash: number;
  /**
   * Always zero.
   *
   * The statement is derived from the movement of every non-cash account, and by double entry the
   * movements of all accounts sum to zero — so the classified total *is* the change in cash, not an
   * estimate of it. The field is reported anyway, because a statement that claims to tie should
   * show its work, and a non-zero value here would mean the ledger is unbalanced.
   */
  unexplainedDifference: number;
}

/**
 * Every account line in a set of sections, flattened.
 *
 * The statements are grouped into classified sections because that is how a balance sheet is read.
 * Callers that want the raw account list — consolidation, the report builder, the dashboard — take
 * it from here rather than each re-deriving the grouping.
 */
export function flattenSections(sections: ReportSection[]): ReportAccountLine[] {
  return sections.flatMap((section) => section.accounts);
}

/** Every balance-sheet account line in a report, across all three statements of position. */
export function balanceSheetAccounts(report: BalanceSheetReport): ReportAccountLine[] {
  return [
    ...flattenSections(report.assets.sections),
    ...flattenSections(report.liabilities.sections),
    ...flattenSections(report.equity.sections),
  ];
}

/** Every profit-and-loss account line in an income statement, in presentation order. */
export function incomeStatementAccounts(
  report: IncomeStatementReport,
): ReportAccountLine[] {
  return [
    ...flattenSections(report.revenue.sections),
    ...report.costOfSales.accounts,
    ...report.operatingExpenses.accounts,
    ...report.nonOperating.accounts,
  ];
}

/**
 * The statutory financial statements.
 *
 * ## What was wrong
 *
 * The balance sheet and income statement read `monthly_account_balances` and filtered it on
 * `mb.ledgerId` — a column that exists in neither the entity nor the table, in any migration. Their
 * primary path, the one taken whenever no dimension filter was supplied, could only raise a
 * PostgreSQL error. It made no difference that it did: `ReportingService`, the nightly job meant to
 * populate that table, was registered in no module, so the table had no writer and was empty.
 *
 * The dimension-filtered path did read the journal, but no query anywhere filtered
 * `entry.status`, so drafts, entries awaiting approval and superseded entries were counted as
 * posted.
 *
 * Everything here now goes through `AccountBalancesService`, which reads the journal, filters to
 * posted entries in one place, and states its sign convention once.
 *
 * ## The cash flow statement ties, by construction
 *
 * The previous statement summed a hand-picked set of accounts — depreciation from a single
 * configured account, working capital from exactly three configured accounts, investing from every
 * non-current asset including accumulated depreciation, which was also added back as a non-cash
 * charge and so counted twice — and never compared its total to the actual movement in cash.
 *
 * This one starts from the identity that makes double-entry work: the signed movements of *all*
 * accounts over any interval sum to zero. So the movement in cash is exactly the negated sum of
 * the movements of everything that is not cash. Classifying those non-cash accounts into operating,
 * investing and financing therefore partitions the change in cash rather than approximating it, and
 * `openingCash + operating + investing + financing = closingCash` holds identically.
 */
@Injectable()
export class FinancialReportingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly balances: AccountBalancesService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Shared plumbing
  // ───────────────────────────────────────────────────────────────────────────

  private async resolveLedger(
    organizationId: string,
    ledgerId?: string,
    manager?: EntityManager,
  ): Promise<Ledger> {
    const repo = (manager ?? this.dataSource.manager).getRepository(Ledger);
    const ledger = ledgerId
      ? await repo.findOneBy({ id: ledgerId, organizationId })
      : await repo.findOneBy({ organizationId, isDefault: true });

    if (!ledger) {
      throw ledgerId
        ? new NotFoundError('FINANCIAL_REPORTING.LIBRO_CONTABLE_ID_NO_FUE_ENCONTRADO_NO', {
            ledgerId,
          })
        : new BadRequestError('FINANCIAL_REPORTING.NO_HA_ESPECIFICADO_LIBRO_CONTABLE_NO_HAY');
    }
    return ledger;
  }

  private ledgerRef(ledger: Ledger): LedgerRef {
    return { id: ledger.id, name: ledger.name, currency: ledger.currency };
  }

  private async accountsOf(
    organizationId: string,
    manager?: EntityManager,
  ): Promise<Map<string, Account>> {
    const accounts = await (manager ?? this.dataSource.manager).find(Account, {
      where: { organizationId },
    });
    return new Map(accounts.map((account) => [account.id, account]));
  }

  private line(account: Account, signedBalance: number): ReportAccountLine {
    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      category: account.category,
      amount: toNaturalAmount(account.type, signedBalance),
    };
  }

  private sectionsFor(
    lines: ReportAccountLine[],
    order: AccountCategory[],
  ): { sections: ReportSection[]; total: number } {
    const byCategory = new Map<AccountCategory, ReportAccountLine[]>();
    for (const line of lines) {
      const bucket = byCategory.get(line.category);
      if (bucket) bucket.push(line);
      else byCategory.set(line.category, [line]);
    }

    const categories = [
      ...order.filter((category) => byCategory.has(category)),
      ...[...byCategory.keys()].filter((category) => !order.includes(category)),
    ];

    const sections = categories.map((category) => {
      const accounts = (byCategory.get(category) ?? []).sort((a, b) =>
        a.code.localeCompare(b.code),
      );
      return {
        category,
        accounts,
        subtotal: sumAmounts(accounts.map((account) => account.amount)),
      };
    });

    return {
      sections,
      total: sumAmounts(sections.map((section) => section.subtotal)),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Balance sheet
  // ───────────────────────────────────────────────────────────────────────────

  async getBalanceSheet(
    organizationId: string,
    asOfDate: Date | string,
    filters: DimensionFilters = {},
    ledgerId?: string,
  ): Promise<BalanceSheetReport> {
    const ledger = await this.resolveLedger(organizationId, ledgerId);
    const asOf = toIsoDate(asOfDate);
    const accounts = await this.accountsOf(organizationId);

    const balances = await this.balances.balancesAsOf({
      organizationId,
      ledgerId: ledger.id,
      dimensions: filters,
      asOf,
    });

    const assetLines: ReportAccountLine[] = [];
    const liabilityLines: ReportAccountLine[] = [];
    const equityLines: ReportAccountLine[] = [];
    let unclosedResultCents = 0;

    for (const [accountId, signedBalance] of balances) {
      const account = accounts.get(accountId);
      if (!account) continue;
      if (toCents(signedBalance) === 0) continue;

      switch (account.type) {
        case AccountType.ASSET:
          assetLines.push(this.line(account, signedBalance));
          break;
        case AccountType.LIABILITY:
          liabilityLines.push(this.line(account, signedBalance));
          break;
        case AccountType.EQUITY:
          equityLines.push(this.line(account, signedBalance));
          break;
        case AccountType.REVENUE:
        case AccountType.EXPENSE:
          // Whatever profit and loss balance survives at the cut-off is precisely the part of the
          // year no close has swept into retained earnings — the closing entries are themselves in
          // the journal, so this cannot double-count a period that has already been closed. The
          // previous implementation added a separately computed year-to-date figure on top of
          // retained earnings and did double-count exactly that way.
          unclosedResultCents += toCents(signedBalance);
          break;
      }
    }

    const assets = this.sectionsFor(assetLines, [
      AccountCategory.CURRENT_ASSET,
      AccountCategory.NON_CURRENT_ASSET,
    ]);
    const liabilities = this.sectionsFor(liabilityLines, [
      AccountCategory.CURRENT_LIABILITY,
      AccountCategory.NON_CURRENT_LIABILITY,
    ]);
    const equitySections = this.sectionsFor(equityLines, [
      AccountCategory.OWNERS_EQUITY,
      AccountCategory.RETAINED_EARNINGS,
    ]);

    const unclosedResult = roundAmount(-unclosedResultCents / 100);
    const equityTotal = roundAmount(equitySections.total + unclosedResult);
    const totalLiabilitiesAndEquity = roundAmount(liabilities.total + equityTotal);
    const outOfBalanceCents = toCents(assets.total) - toCents(totalLiabilitiesAndEquity);

    return {
      asOfDate: asOf,
      filters,
      ledger: this.ledgerRef(ledger),
      assets,
      liabilities,
      equity: {
        sections: equitySections.sections,
        unclosedResult,
        total: equityTotal,
      },
      totalLiabilitiesAndEquity,
      isBalanced: outOfBalanceCents === 0,
      outOfBalanceBy: roundAmount(outOfBalanceCents / 100),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Income statement
  // ───────────────────────────────────────────────────────────────────────────

  async getIncomeStatement(
    organizationId: string,
    startDate: Date | string,
    endDate: Date | string,
    filters: DimensionFilters = {},
    ledgerId?: string,
  ): Promise<IncomeStatementReport> {
    const ledger = await this.resolveLedger(organizationId, ledgerId);
    const from = toIsoDate(startDate);
    const to = toIsoDate(endDate);
    const accounts = await this.accountsOf(organizationId);

    const resultAccountIds = [...accounts.values()]
      .filter(
        (account) =>
          account.type === AccountType.REVENUE || account.type === AccountType.EXPENSE,
      )
      .map((account) => account.id);

    const movements = await this.balances.movements({
      organizationId,
      ledgerId: ledger.id,
      accountIds: resultAccountIds,
      dimensions: filters,
      from,
      to,
    });

    const revenueLines: ReportAccountLine[] = [];
    const costOfSales: ReportAccountLine[] = [];
    const operatingExpenses: ReportAccountLine[] = [];
    const nonOperating: ReportAccountLine[] = [];

    for (const movement of movements) {
      const account = accounts.get(movement.accountId);
      if (!account) continue;
      const signed = roundAmount(movement.debit - movement.credit);
      if (toCents(signed) === 0) continue;
      const line = this.line(account, signed);

      if (account.type === AccountType.REVENUE) {
        if (account.category === AccountCategory.NON_OPERATING_REVENUE) nonOperating.push(line);
        else revenueLines.push(line);
        continue;
      }
      switch (account.category) {
        case AccountCategory.COST_OF_GOODS_SOLD:
          costOfSales.push(line);
          break;
        case AccountCategory.NON_OPERATING_EXPENSE:
          // Negated so a non-operating expense reduces the non-operating subtotal, which is
          // presented as a net figure alongside non-operating income.
          nonOperating.push({ ...line, amount: roundAmount(-line.amount) });
          break;
        default:
          operatingExpenses.push(line);
      }
    }

    const revenue = this.sectionsFor(revenueLines, [AccountCategory.OPERATING_REVENUE]);
    const costTotal = sumAmounts(costOfSales.map((line) => line.amount));
    const operatingExpenseTotal = sumAmounts(operatingExpenses.map((line) => line.amount));
    const nonOperatingTotal = sumAmounts(nonOperating.map((line) => line.amount));

    const grossProfit = roundAmount(revenue.total - costTotal);
    const operatingIncome = roundAmount(grossProfit - operatingExpenseTotal);

    return {
      period: { startDate: from, endDate: to },
      filters,
      ledger: this.ledgerRef(ledger),
      revenue,
      costOfSales: {
        accounts: costOfSales.sort((a, b) => a.code.localeCompare(b.code)),
        total: costTotal,
      },
      grossProfit,
      operatingExpenses: {
        accounts: operatingExpenses.sort((a, b) => a.code.localeCompare(b.code)),
        total: operatingExpenseTotal,
      },
      operatingIncome,
      nonOperating: {
        accounts: nonOperating.sort((a, b) => a.code.localeCompare(b.code)),
        total: nonOperatingTotal,
      },
      netIncome: roundAmount(operatingIncome + nonOperatingTotal),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Trial balance
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The balanza de comprobación.
   *
   * There was no trial balance anywhere in the product. It is the report an accountant opens first,
   * and a legally required book in most of the markets this ships to. Presented in the classical
   * six-column form, with each signed balance split onto the side it actually falls on, so the
   * debit and credit totals are directly comparable.
   */
  async getTrialBalance(
    organizationId: string,
    startDate: Date | string,
    endDate: Date | string,
    ledgerId?: string,
  ): Promise<TrialBalanceReport> {
    const ledger = await this.resolveLedger(organizationId, ledgerId);
    const from = toIsoDate(startDate);
    const to = toIsoDate(endDate);
    const accounts = await this.accountsOf(organizationId);

    const rows = await this.balances.trialBalance({
      organizationId,
      ledgerId: ledger.id,
      from,
      to,
    });

    const split = (signed: number) => ({
      debit: signed > 0 ? roundAmount(signed) : 0,
      credit: signed < 0 ? roundAmount(-signed) : 0,
    });

    const reportRows = rows
      .map((row) => {
        const account = accounts.get(row.accountId);
        if (!account) return null;
        const opening = split(row.openingBalance);
        const closing = split(row.closingBalance);
        return {
          accountId: row.accountId,
          code: account.code,
          name: account.name,
          type: account.type,
          openingDebit: opening.debit,
          openingCredit: opening.credit,
          periodDebit: roundAmount(row.debit),
          periodCredit: roundAmount(row.credit),
          closingDebit: closing.debit,
          closingCredit: closing.credit,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => a.code.localeCompare(b.code));

    const total = (key: keyof (typeof reportRows)[number]) =>
      sumAmounts(reportRows.map((row) => row[key] as number));

    const totals = {
      openingDebit: total('openingDebit'),
      openingCredit: total('openingCredit'),
      periodDebit: total('periodDebit'),
      periodCredit: total('periodCredit'),
      closingDebit: total('closingDebit'),
      closingCredit: total('closingCredit'),
    };

    return {
      period: { startDate: from, endDate: to },
      ledger: this.ledgerRef(ledger),
      rows: reportRows,
      totals,
      isBalanced:
        toCents(totals.openingDebit) === toCents(totals.openingCredit) &&
        toCents(totals.periodDebit) === toCents(totals.periodCredit) &&
        toCents(totals.closingDebit) === toCents(totals.closingCredit),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Cash flow
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Which accounts are cash.
   *
   * Taken from the operational role stamped on the account at provisioning, so it survives a
   * renamed account, a translated chart, and a statutory plan whose codes differ. A tenant with no
   * cash account configured gets a clear error rather than a statement with an opening balance of
   * zero.
   */
  private cashAccountIds(accounts: Map<string, Account>): string[] {
    const ids = [...accounts.values()]
      .filter(
        (account) =>
          account.systemRole === AccountRole.CASH ||
          account.systemRole === AccountRole.BANK ||
          account.statementMapping?.cashFlowCategory === 'CASH',
      )
      .map((account) => account.id);

    if (ids.length === 0) {
      throw new BadRequestError('FINANCIAL_REPORTING.NO_HAY_CUENTAS_DE_EFECTIVO_CONFIGURADAS');
    }
    return ids;
  }

  async getCashFlowStatement(
    organizationId: string,
    startDate: Date | string,
    endDate: Date | string,
    ledgerId?: string,
  ): Promise<CashFlowStatementReport> {
    const ledger = await this.resolveLedger(organizationId, ledgerId);
    const from = toIsoDate(startDate);
    const to = toIsoDate(endDate);
    const accounts = await this.accountsOf(organizationId);

    const cashIds = new Set(this.cashAccountIds(accounts));
    const scope = { organizationId, ledgerId: ledger.id };

    const [openingBalances, closingBalances, movements] = await Promise.all([
      this.balances.balancesAsOf(
        { ...scope, accountIds: [...cashIds], asOf: previousDay(from) },
      ),
      this.balances.balancesAsOf({ ...scope, accountIds: [...cashIds], asOf: to }),
      this.balances.movements({ ...scope, from, to }),
    ]);

    const sumOf = (balances: Map<string, number>) =>
      sumAmounts([...balances.values()]);

    const openingCash = sumOf(openingBalances);
    const closingCash = sumOf(closingBalances);

    const nonCashAdjustments: { accountId: string; code: string; amount: number }[] = [];
    const workingCapitalChanges: { accountId: string; code: string; amount: number }[] = [];
    const investingMovements: { accountId: string; code: string; amount: number }[] = [];
    const financingMovements: { accountId: string; code: string; amount: number }[] = [];
    let netIncomeCents = 0;

    for (const movement of movements) {
      if (cashIds.has(movement.accountId)) continue;
      const account = accounts.get(movement.accountId);
      if (!account) continue;

      const signed = movement.debit - movement.credit;
      if (toCents(signed) === 0) continue;

      // The cash effect of a non-cash account is the negation of its own movement. Receivables
      // going up (a debit) consumes cash; revenue (a credit) provides it.
      const cashEffect = roundAmount(-signed);
      const entry = { accountId: account.id, code: account.code, amount: cashEffect };

      if (
        account.type === AccountType.REVENUE ||
        account.type === AccountType.EXPENSE
      ) {
        netIncomeCents += toCents(cashEffect);
        continue;
      }

      switch (account.category) {
        case AccountCategory.NON_CURRENT_ASSET:
          // Accumulated depreciation is a non-current asset by category and a non-cash charge in
          // substance. Treating it as investing — as the old statement did, while *also* adding
          // depreciation expense back as a non-cash charge — counted it twice.
          if (account.systemRole === AccountRole.ACCUMULATED_DEPRECIATION) {
            nonCashAdjustments.push(entry);
          } else {
            investingMovements.push(entry);
          }
          break;
        case AccountCategory.NON_CURRENT_LIABILITY:
          financingMovements.push(entry);
          break;
        case AccountCategory.CURRENT_ASSET:
        case AccountCategory.CURRENT_LIABILITY:
          workingCapitalChanges.push(entry);
          break;
        default:
          if (account.type === AccountType.EQUITY) financingMovements.push(entry);
          else workingCapitalChanges.push(entry);
      }
    }

    const netIncome = roundAmount(netIncomeCents / 100);
    const nonCashTotal = sumAmounts(nonCashAdjustments.map((item) => item.amount));
    const workingCapitalTotal = sumAmounts(
      workingCapitalChanges.map((item) => item.amount),
    );
    const operatingTotal = roundAmount(netIncome + nonCashTotal + workingCapitalTotal);
    const investingTotal = sumAmounts(investingMovements.map((item) => item.amount));
    const financingTotal = sumAmounts(financingMovements.map((item) => item.amount));
    const netChangeInCash = roundAmount(
      operatingTotal + investingTotal + financingTotal,
    );

    const bySize = (
      a: { amount: number },
      b: { amount: number },
    ) => Math.abs(b.amount) - Math.abs(a.amount);

    return {
      period: { startDate: from, endDate: to },
      ledger: this.ledgerRef(ledger),
      openingCash,
      operating: {
        netIncome,
        nonCashAdjustments: nonCashAdjustments.sort(bySize),
        workingCapitalChanges: workingCapitalChanges.sort(bySize),
        total: operatingTotal,
      },
      investing: { movements: investingMovements.sort(bySize), total: investingTotal },
      financing: { movements: financingMovements.sort(bySize), total: financingTotal },
      netChangeInCash,
      closingCash,
      unexplainedDifference: roundAmount(
        (toCents(openingCash) + toCents(netChangeInCash) - toCents(closingCash)) / 100,
      ),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Cash flow components, kept for the dashboard's consolidated view
  // ───────────────────────────────────────────────────────────────────────────

  async getInvestingActivities(
    organizationId: string,
    startDate: Date | string,
    endDate: Date | string,
    ledgerId?: string,
  ): Promise<number> {
    return (await this.getCashFlowStatement(organizationId, startDate, endDate, ledgerId))
      .investing.total;
  }

  async getFinancingActivities(
    organizationId: string,
    startDate: Date | string,
    endDate: Date | string,
    ledgerId?: string,
  ): Promise<number> {
    return (await this.getCashFlowStatement(organizationId, startDate, endDate, ledgerId))
      .financing.total;
  }

  /** Net income over an interval, for callers that need the figure without the whole statement. */
  async getNetIncome(
    organizationId: string,
    startDate: Date | string,
    endDate: Date | string,
    ledgerId?: string,
  ): Promise<number> {
    const ledger = await this.resolveLedger(organizationId, ledgerId);
    return this.balances.netIncome({
      organizationId,
      ledgerId: ledger.id,
      from: startDate,
      to: endDate,
    });
  }

  /**
   * The accounts holding a given operational role, for callers that need to reach one by meaning.
   *
   * Falls back to `OrganizationSettings` where a role has not been stamped, so a tenant provisioned
   * before roles existed still resolves.
   */
  async resolveRoleAccountId(
    organizationId: string,
    role: AccountRole,
    settingsKey?: keyof OrganizationSettings,
  ): Promise<string | null> {
    const account = await this.dataSource.manager.findOne(Account, {
      where: { organizationId, systemRole: role },
    });
    if (account) return account.id;
    if (!settingsKey) return null;
    const settings = await this.dataSource.manager.findOneBy(OrganizationSettings, {
      organizationId,
    });
    const value = settings?.[settingsKey];
    return typeof value === 'string' ? value : null;
  }
}
