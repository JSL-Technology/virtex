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

/**
 * A movement in the investing or financing section, presented gross.
 *
 * IAS 7.21 and ASC 230-10-45-7 require gross presentation: cash received and cash paid are two
 * figures, not the difference between them. Netting them per account hides exactly what the
 * section exists to show — a year in which a company sold one building and bought another looked
 * like a year in which it did nothing.
 */
export interface CashFlowMovement {
  accountId: string;
  code: string;
  /** Cash received through this account over the period, as a positive amount. */
  inflow: number;
  /** Cash paid through this account over the period, as a positive amount. */
  outflow: number;
  /** `inflow − outflow`. */
  amount: number;
}

/** A section presented gross, with its two sides stated as well as its net. */
export interface CashFlowSection {
  movements: CashFlowMovement[];
  inflows: number;
  outflows: number;
  total: number;
}

/**
 * A transaction that changed the balance sheet without moving any cash.
 *
 * IAS 7.43 requires these to be excluded from the statement and disclosed. An asset bought on
 * supplier credit, a loan converted to equity, a dividend declared but unpaid: including them
 * produced an investing outflow and a financing inflow for money that never moved, which is the
 * one thing a reader of this statement must be able to rely on not happening.
 */
export interface NonCashTransactionLine {
  accountId: string;
  code: string;
  debit: number;
  credit: number;
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
  investing: CashFlowSection;
  financing: CashFlowSection;
  /**
   * The effect of exchange-rate changes on cash held in foreign currency.
   *
   * A separate reconciling line, outside the three activity sections, as IAS 7.28 and
   * ASC 230-10-45-25 require. It is the movement the period-end revaluation put through the cash
   * accounts themselves: no cash moved, but the reporting-currency figure changed, and without
   * this line that change has to be smuggled into operating activities to make the statement tie.
   *
   * The rest of that revaluation — the unrealised gain or loss in profit, and the restatement of
   * foreign-currency receivables and payables — is removed from operating in the same step, which
   * is why `netIncome` is reconciled by an adjustment rather than silently reduced.
   */
  effectOfExchangeRateOnCash: number;
  /** Transactions excluded from the statement because no cash moved (IAS 7.43). */
  nonCashTransactions: NonCashTransactionLine[];
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

  /**
   * Both ends of a period, in order.
   *
   * An inverted range used to be accepted silently: `startDate=2026-12-31&endDate=2026-01-01`
   * produced a statement of zeroes, which a reader takes for "no activity" rather than "you asked
   * for a period that runs backwards".
   */
  private periodOf(startDate: Date | string, endDate: Date | string): { from: string; to: string } {
    const from = toIsoDate(startDate);
    const to = toIsoDate(endDate);
    if (from > to) {
      throw new BadRequestError('VALIDATION.CONSTRAINTS.PERIOD_START_AFTER_END');
    }
    return { from, to };
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
    const { from, to } = this.periodOf(startDate, endDate);
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
      // Without this, the statement of a closed year reads zero. The annual closing entry debits
      // every revenue account and credits every expense account by its own balance, so summing the
      // movement of those accounts over a range that contains it cancels the year out exactly.
      excludeClosingEntries: true,
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
    const { from, to } = this.periodOf(startDate, endDate);
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

  /**
   * The statement of cash flows, indirect method.
   *
   * ## What it has to satisfy beyond tying to the change in cash
   *
   * The previous statement derived every figure from the net movement of each account over the
   * period. That guaranteed it tied — the movements of all accounts sum to zero, so the classified
   * total *is* the change in cash — but it produced three presentations the standards prohibit:
   *
   * 1. **Netting.** IAS 7.21 and ASC 230-10-45-7 require investing and financing to be gross.
   *    Selling one building and buying another in the same year netted to the difference; drawing
   *    a loan and repaying it netted to nothing. Both are now stated as an inflow and an outflow.
   * 2. **Non-cash transactions.** IAS 7.43 requires transactions that moved no cash to be excluded
   *    and disclosed. An asset acquired on supplier credit appeared as an investing outflow and a
   *    financing inflow of equal size — two cash flows for money that never moved. Entries with no
   *    cash leg are now kept out of both sections and listed separately.
   * 3. **The effect of exchange rates on cash.** IAS 7.28 and ASC 230-10-45-25 require it as a
   *    separate reconciling line. Classified by account category, the period-end revaluation of a
   *    dollar bank account is indistinguishable from a deposit into it, so it was landing inside
   *    operating activities. It is now identified by what posted it.
   *
   * The tie is preserved through all three, and for the same reason as before: every rule here
   * either keeps an entry's lines together or drops all of them, and an entry's lines always sum
   * to zero.
   */
  async getCashFlowStatement(
    organizationId: string,
    startDate: Date | string,
    endDate: Date | string,
    ledgerId?: string,
  ): Promise<CashFlowStatementReport> {
    const ledger = await this.resolveLedger(organizationId, ledgerId);
    const { from, to } = this.periodOf(startDate, endDate);
    const accounts = await this.accountsOf(organizationId);

    const cashAccountIds = this.cashAccountIds(accounts);
    const cashIds = new Set(cashAccountIds);
    const scope = { organizationId, ledgerId: ledger.id };

    const [openingBalances, closingBalances, movements] = await Promise.all([
      this.balances.balancesAsOf(
        { ...scope, accountIds: cashAccountIds, asOf: previousDay(from) },
      ),
      this.balances.balancesAsOf({ ...scope, accountIds: cashAccountIds, asOf: to }),
      // The annual closing entry touches no cash account and its own movements sum to zero, so
      // excluding it leaves `netChangeInCash` exactly where it was — but keeps the presentation
      // honest: without this, a closed year reports a net income of zero and shows the whole
      // result as a financing movement into retained earnings.
      this.balances.classifiedMovements({
        ...scope,
        excludeClosingEntries: true,
        from,
        to,
        cashAccountIds,
      }),
    ]);

    const sumOf = (balances: Map<string, number>) =>
      sumAmounts([...balances.values()]);

    const openingCash = sumOf(openingBalances);
    const closingCash = sumOf(closingBalances);

    const nonCashAdjustments: { accountId: string; code: string; amount: number }[] = [];
    const workingCapitalChanges: { accountId: string; code: string; amount: number }[] = [];
    const investingMovements = new Map<string, CashFlowMovement>();
    const financingMovements = new Map<string, CashFlowMovement>();
    const nonCashTransactions: NonCashTransactionLine[] = [];
    let netIncomeCents = 0;
    let exchangeEffectCents = 0;

    /** Accumulate a gross movement into a section, keyed by account. */
    const addGross = (
      section: Map<string, CashFlowMovement>,
      account: Account,
      inflow: number,
      outflow: number,
    ) => {
      const existing =
        section.get(account.id) ??
        { accountId: account.id, code: account.code, inflow: 0, outflow: 0, amount: 0 };
      existing.inflow = roundAmount(existing.inflow + inflow);
      existing.outflow = roundAmount(existing.outflow + outflow);
      existing.amount = roundAmount(existing.inflow - existing.outflow);
      section.set(account.id, existing);
    };

    for (const movement of movements) {
      const account = accounts.get(movement.accountId);
      if (!account) continue;

      // ── The revaluation entry ────────────────────────────────────────────
      //
      // Its effect on cash is the reconciling line; everything else it did is unrealised and does
      // not belong in any section. Both halves are handled here so the entry stays whole.
      if (movement.origin === 'EXCHANGE_REVALUATION') {
        if (cashIds.has(account.id)) {
          exchangeEffectCents += toCents(movement.debit) - toCents(movement.credit);
          continue;
        }
        // The unrealised gain or loss is in profit, and `netIncome` below is the income
        // statement's own figure, so it has to be reported and then removed — not quietly
        // omitted, which would leave the reader unable to reconcile the two statements.
        if (account.type === AccountType.REVENUE || account.type === AccountType.EXPENSE) {
          const cashEffect = roundAmount(movement.credit - movement.debit);
          netIncomeCents += toCents(cashEffect);
          nonCashAdjustments.push({
            accountId: account.id,
            code: account.code,
            amount: roundAmount(-cashEffect),
          });
        }
        // The restatement of foreign-currency receivables and payables moved no cash and is not a
        // working-capital movement. Dropping it is what keeps the two adjustments above from
        // over-explaining the change in cash.
        continue;
      }

      if (cashIds.has(account.id)) continue;

      const signed = movement.debit - movement.credit;
      if (toCents(signed) === 0 && movement.origin !== 'NON_CASH_TRANSACTION') continue;

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

      // ── An entry that moved no cash ──────────────────────────────────────
      //
      // Disclosed, and kept out of investing and financing. Its balance-sheet lines still have to
      // go somewhere for the statement to tie, and under the indirect method that place is the
      // operating reconciliation: an asset acquired on credit contributes a negative non-cash
      // adjustment and the liability an offsetting positive one, which net to nothing — which is
      // the correct answer, because nothing happened to cash.
      if (movement.origin === 'NON_CASH_TRANSACTION') {
        // Disclosed only where IAS 7.43 asks for it: investing and financing transactions that
        // required no cash. Depreciation reaches this branch too — it moves no cash either — but
        // it is neither, and listing it here would bury the finance lease among the routine.
        if (
          this.isInvestingOrFinancing(account) &&
          (toCents(movement.debit) !== 0 || toCents(movement.credit) !== 0)
        ) {
          nonCashTransactions.push({
            accountId: account.id,
            code: account.code,
            debit: roundAmount(movement.debit),
            credit: roundAmount(movement.credit),
          });
        }
        if (toCents(signed) === 0) continue;
        if (this.isWorkingCapital(account)) workingCapitalChanges.push(entry);
        else nonCashAdjustments.push(entry);
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
            // Gross: a credit to a fixed-asset account is cash coming in from a disposal, a debit
            // is cash going out to buy something. Netting them is what IAS 7.21 prohibits.
            addGross(investingMovements, account, movement.credit, movement.debit);
          }
          break;
        case AccountCategory.NON_CURRENT_LIABILITY:
          // Drawing a loan is a credit and an inflow; repaying it is a debit and an outflow.
          addGross(financingMovements, account, movement.credit, movement.debit);
          break;
        case AccountCategory.CURRENT_ASSET:
        case AccountCategory.CURRENT_LIABILITY:
          workingCapitalChanges.push(entry);
          break;
        default:
          if (account.type === AccountType.EQUITY) {
            addGross(financingMovements, account, movement.credit, movement.debit);
          } else {
            workingCapitalChanges.push(entry);
          }
      }
    }

    const netIncome = roundAmount(netIncomeCents / 100);
    const nonCashTotal = sumAmounts(nonCashAdjustments.map((item) => item.amount));
    const workingCapitalTotal = sumAmounts(
      workingCapitalChanges.map((item) => item.amount),
    );
    const operatingTotal = roundAmount(netIncome + nonCashTotal + workingCapitalTotal);
    const effectOfExchangeRateOnCash = roundAmount(exchangeEffectCents / 100);

    const bySize = (
      a: { amount: number },
      b: { amount: number },
    ) => Math.abs(b.amount) - Math.abs(a.amount);

    const sectionOf = (movementsByAccount: Map<string, CashFlowMovement>): CashFlowSection => {
      const list = [...movementsByAccount.values()]
        // An account whose gross sides are both zero moved nothing and is not a line of the
        // statement. One whose sides cancel did two real things and stays.
        .filter((item) => toCents(item.inflow) !== 0 || toCents(item.outflow) !== 0)
        .sort(bySize);
      const inflows = sumAmounts(list.map((item) => item.inflow));
      const outflows = sumAmounts(list.map((item) => item.outflow));
      return {
        movements: list,
        inflows,
        outflows,
        total: roundAmount(inflows - outflows),
      };
    };

    const investing = sectionOf(investingMovements);
    const financing = sectionOf(financingMovements);
    const netChangeInCash = roundAmount(
      operatingTotal + investing.total + financing.total + effectOfExchangeRateOnCash,
    );

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
      investing,
      financing,
      effectOfExchangeRateOnCash,
      nonCashTransactions: nonCashTransactions.sort(
        (a, b) => Math.abs(b.debit + b.credit) - Math.abs(a.debit + a.credit),
      ),
      netChangeInCash,
      closingCash,
      unexplainedDifference: roundAmount(
        (toCents(openingCash) + toCents(netChangeInCash) - toCents(closingCash)) / 100,
      ),
    };
  }

  /**
   * Whether a balance-sheet account belongs in the working-capital reconciliation.
   *
   * Only relevant for entries that moved no cash, where the line cannot go to investing or
   * financing and has to land on the correct side of the operating reconciliation instead.
   */
  private isWorkingCapital(account: Account): boolean {
    return (
      account.category === AccountCategory.CURRENT_ASSET ||
      account.category === AccountCategory.CURRENT_LIABILITY
    );
  }

  /**
   * Whether a movement through this account would have been an investing or financing activity
   * had cash been involved — which is the scope of the IAS 7.43 disclosure.
   *
   * Accumulated depreciation is excluded for the same reason it is excluded from the investing
   * section: by category it is a non-current asset, in substance it is a non-cash charge.
   */
  private isInvestingOrFinancing(account: Account): boolean {
    if (account.systemRole === AccountRole.ACCUMULATED_DEPRECIATION) return false;
    return (
      account.category === AccountCategory.NON_CURRENT_ASSET ||
      account.category === AccountCategory.NON_CURRENT_LIABILITY ||
      account.type === AccountType.EQUITY
    );
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
