import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import {
  JournalEntry,
  JournalEntryStatus,
} from '../journal-entries/entities/journal-entry.entity';
import { Account, AccountType } from './entities/account.entity';

/**
 * Account balances, derived from the journal.
 *
 * ## Why there is no balance table
 *
 * There used to be two, and they disagreed with each other and with the journal.
 *
 * `account_balances` held one cumulative figure per (account, ledger) with no period dimension,
 * incremented by deltas from a BullMQ worker after the posting transaction committed. That made a
 * balance *eventually* consistent with the entry that caused it: a job that exhausted its retries,
 * or a worker that died between the SQL commit and the queue acknowledgement, left the figure
 * permanently wrong with nothing to detect it and no way to recompute it. It also meant the close
 * read balances that did not yet include the depreciation and revaluation entries the close itself
 * had just posted, and that "carry the balance forward" had to be expressed as a journal entry
 * re-posting every balance-sheet account — which the worker then added on top of the balance it was
 * supposed to be carrying, doubling the balance sheet at every close.
 *
 * `monthly_account_balances` was a nightly full recompute with no ledger column at all, which the
 * balance sheet and income statement nonetheless filtered on. Their primary code path could not run.
 *
 * Both are gone. Every balance in the product is now a `SUM` over `journal_entry_line_valuations`
 * joined to its entry, computed at read time. A balance cannot drift from the journal because it
 * *is* the journal, there is nothing to rebuild, nothing to reconcile, and a posting is visible to
 * the next read the instant its transaction commits — including to a caller reading through the
 * same `EntityManager` inside that transaction, which is what the close depends on.
 *
 * If a rollup is ever needed for scale, it belongs behind this interface, where it can be validated
 * against these queries rather than replacing them.
 *
 * ## The sign convention, stated once
 *
 * Every figure this service returns is **signed**: `debit − credit`.
 *
 * That makes an asset or expense with normal activity positive, and a liability, equity or revenue
 * account negative. It is the convention the database rows are in, so no method here silently flips
 * it. Presenting revenue as a positive number, or deciding which side of a closing entry an account
 * belongs on, is a separate step — `toNaturalAmount` and `closingSideFor` below — and the
 * arithmetic lives in exactly one place because getting it wrong in two places independently is
 * what produced a close that skipped every revenue account and a year-end close that could not
 * balance.
 *
 * ## Posted only
 *
 * Every query filters `status = POSTED`. A draft entry has its lines persisted, so a report that
 * omits this filter silently counts entries nobody approved, and superseded entries kept for
 * lineage. The filter is applied here rather than at each call site, because the call sites are
 * where it went missing.
 */

/** A signed balance per account: `debit − credit`. */
export type SignedBalances = Map<string, number>;

export interface AccountMovement {
  accountId: string;
  debit: number;
  credit: number;
}

export interface BalanceScope {
  organizationId: string;
  ledgerId: string;
  /** Restrict to these accounts. Omit for every account with activity. */
  accountIds?: string[];
  /** Analytical dimension filters, as `{ dimensionKey: valueId }`. */
  dimensions?: Record<string, string>;
}

export interface TrialBalanceRow {
  accountId: string;
  openingBalance: number;
  debit: number;
  credit: number;
  closingBalance: number;
}

/** `YYYY-MM-DD`. Dates cross the boundary as strings so no timezone can shift a posting a day. */
export type IsoDate = string;

export function toIsoDate(value: Date | string): IsoDate {
  if (typeof value === 'string') {
    // Already `YYYY-MM-DD`, or an ISO timestamp whose date part is what we want.
    return value.slice(0, 10);
  }
  // Deliberately UTC: a `date` column has no timezone, and using the server's local
  // calendar here is how an entry dated the 1st gets filed under the previous month.
  return value.toISOString().slice(0, 10);
}

/** The day before `date`, as `YYYY-MM-DD`. */
export function previousDay(date: Date | string): IsoDate {
  const d = new Date(`${toIsoDate(date)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class AccountBalancesService {
  constructor(private readonly dataSource: DataSource) {}

  private manager(manager?: EntityManager): EntityManager {
    return manager ?? this.dataSource.manager;
  }

  /**
   * The shared skeleton of every balance query.
   *
   * Joins line → entry → valuation, scopes to the tenant and ledger, and restricts to posted
   * entries. Callers add only their own date predicate.
   */
  private baseQuery(
    manager: EntityManager,
    scope: BalanceScope,
  ): SelectQueryBuilder<JournalEntryLine> {
    const qb = manager
      .createQueryBuilder(JournalEntryLine, 'line')
      .innerJoin('line.journalEntry', 'entry')
      .innerJoin('line.valuations', 'valuation')
      .where('entry.organizationId = :organizationId', {
        organizationId: scope.organizationId,
      })
      .andWhere('entry.status = :postedStatus', {
        postedStatus: JournalEntryStatus.POSTED,
      })
      .andWhere('valuation.ledgerId = :ledgerId', { ledgerId: scope.ledgerId });

    if (scope.accountIds) {
      if (scope.accountIds.length === 0) {
        // An explicit empty selection means "no accounts", not "every account".
        qb.andWhere('1 = 0');
      } else {
        qb.andWhere('line.accountId IN (:...scopedAccountIds)', {
          scopedAccountIds: scope.accountIds,
        });
      }
    }

    for (const [index, [dimensionKey, valueId]] of Object.entries(
      scope.dimensions ?? {},
    ).entries()) {
      // Parameter names are generated, never interpolated from the key, so a dimension
      // named like a bind parameter cannot collide with or escape the query.
      const keyParam = `dimKey${index}`;
      const valueParam = `dimValue${index}`;
      qb.andWhere(`line.dimensions ->> :${keyParam} = :${valueParam}`, {
        [keyParam]: dimensionKey,
        [valueParam]: valueId,
      });
    }

    return qb;
  }

  /**
   * Debits and credits per account over a closed date interval, both ends inclusive.
   *
   * Accounts with no activity in the interval are absent from the result rather than present with
   * zeroes — callers that need a full chart of accounts join this onto their own account list.
   */
  async movements(
    scope: BalanceScope & { from: Date | string; to: Date | string },
    manager?: EntityManager,
  ): Promise<AccountMovement[]> {
    const rows = await this.baseQuery(this.manager(manager), scope)
      .andWhere('entry.date BETWEEN :from AND :to', {
        from: toIsoDate(scope.from),
        to: toIsoDate(scope.to),
      })
      .select('line.accountId', 'accountId')
      .addSelect('COALESCE(SUM(valuation.debit), 0)', 'debit')
      .addSelect('COALESCE(SUM(valuation.credit), 0)', 'credit')
      .groupBy('line.accountId')
      .getRawMany<{ accountId: string; debit: string; credit: string }>();

    return rows.map((row) => ({
      accountId: row.accountId,
      debit: Number(row.debit),
      credit: Number(row.credit),
    }));
  }

  /**
   * Signed balance per account for everything posted on or before `asOf`.
   *
   * This is the cumulative figure: it has no period boundary and needs none, because the entries
   * carry their own dates. It is what a balance sheet reads.
   */
  async balancesAsOf(
    scope: BalanceScope & { asOf: Date | string },
    manager?: EntityManager,
  ): Promise<SignedBalances> {
    const rows = await this.baseQuery(this.manager(manager), scope)
      .andWhere('entry.date <= :asOf', { asOf: toIsoDate(scope.asOf) })
      .select('line.accountId', 'accountId')
      .addSelect('COALESCE(SUM(valuation.debit - valuation.credit), 0)', 'balance')
      .groupBy('line.accountId')
      .getRawMany<{ accountId: string; balance: string }>();

    return new Map(rows.map((row) => [row.accountId, Number(row.balance)]));
  }

  /** The signed balance of a single account as at a date. Zero when it has never been posted to. */
  async balanceOf(
    accountId: string,
    scope: Omit<BalanceScope, 'accountIds'> & { asOf: Date | string },
    manager?: EntityManager,
  ): Promise<number> {
    const balances = await this.balancesAsOf(
      { ...scope, accountIds: [accountId] },
      manager,
    );
    return balances.get(accountId) ?? 0;
  }

  /**
   * Opening balance, period movement and closing balance per account — the balanza de comprobación.
   *
   * Only accounts that either carry an opening balance or moved during the interval appear.
   * `closingBalance` is `openingBalance + debit − credit` by construction, so the report cannot
   * show a closing figure that disagrees with the movement that produced it.
   */
  async trialBalance(
    scope: BalanceScope & { from: Date | string; to: Date | string },
    manager?: EntityManager,
  ): Promise<TrialBalanceRow[]> {
    const [opening, movements] = await Promise.all([
      this.balancesAsOf({ ...scope, asOf: previousDay(scope.from) }, manager),
      this.movements(scope, manager),
    ]);

    const byAccount = new Map<string, TrialBalanceRow>();
    for (const [accountId, openingBalance] of opening) {
      byAccount.set(accountId, {
        accountId,
        openingBalance,
        debit: 0,
        credit: 0,
        closingBalance: openingBalance,
      });
    }
    for (const movement of movements) {
      const row = byAccount.get(movement.accountId) ?? {
        accountId: movement.accountId,
        openingBalance: 0,
        debit: 0,
        credit: 0,
        closingBalance: 0,
      };
      row.debit = movement.debit;
      row.credit = movement.credit;
      row.closingBalance = row.openingBalance + movement.debit - movement.credit;
      byAccount.set(movement.accountId, row);
    }

    return [...byAccount.values()].filter(
      (row) => row.openingBalance !== 0 || row.debit !== 0 || row.credit !== 0,
    );
  }

  /**
   * Balance per account expressed in the *document* currency, for revaluation.
   *
   * A foreign-currency posting stores both figures: `foreign_currency_debit`/`credit` hold what
   * the document said, and `debit`/`credit` hold what it was worth in ledger currency on the day.
   * Revaluation needs the first, restated at the closing rate, to work out what the second should
   * now be.
   *
   * This used to come from `account_balances.balance_in_foreign_currency`, a column the balance
   * worker never wrote — it only ever updated `balance`. So the revaluation read zero for every
   * account, computed a difference of `0 − carrying amount`, and posted the entire balance of
   * every multicurrency account as an exchange loss, on every period close.
   */
  async foreignCurrencyBalancesAsOf(
    scope: BalanceScope & { asOf: Date | string },
    manager?: EntityManager,
  ): Promise<SignedBalances> {
    const rows = await this.baseQuery(this.manager(manager), scope)
      .andWhere('entry.date <= :asOf', { asOf: toIsoDate(scope.asOf) })
      .andWhere('line.foreignCurrencyDebit IS NOT NULL OR line.foreignCurrencyCredit IS NOT NULL')
      .select('line.accountId', 'accountId')
      .addSelect(
        'COALESCE(SUM(COALESCE(line.foreignCurrencyDebit, 0) - COALESCE(line.foreignCurrencyCredit, 0)), 0)',
        'balance',
      )
      .groupBy('line.accountId')
      .getRawMany<{ accountId: string; balance: string }>();

    return new Map(rows.map((row) => [row.accountId, Number(row.balance)]));
  }

  /**
   * Net income over an interval, signed as `revenue − expenses`.
   *
   * Positive is a profit. This is the figure a closing entry moves to retained earnings and the
   * one a balance sheet adds to equity for the unclosed part of the year.
   */
  async netIncome(
    scope: Omit<BalanceScope, 'accountIds'> & { from: Date | string; to: Date | string },
    manager?: EntityManager,
  ): Promise<number> {
    const em = this.manager(manager);
    const resultAccounts = await em.find(Account, {
      where: { organizationId: scope.organizationId },
      select: { id: true, type: true },
    });
    const accountIds = resultAccounts
      .filter(
        (account) =>
          account.type === AccountType.REVENUE || account.type === AccountType.EXPENSE,
      )
      .map((account) => account.id);

    if (accountIds.length === 0) return 0;

    const movements = await this.movements({ ...scope, accountIds }, em);
    // Revenue and expense are both signed `debit − credit`, so revenue is negative and expense
    // positive; the profit is the negation of their sum. Writing it this way means the formula
    // does not need to know which account is which.
    return -movements.reduce(
      (total, movement) => total + movement.debit - movement.credit,
      0,
    );
  }
}

/**
 * A signed balance rendered the way a reader expects to see that account.
 *
 * Assets and expenses keep their sign; liabilities, equity and revenue are negated, so a revenue
 * account that earned 500 reads as `500` rather than `-500`. Presentation only — never store this.
 */
export function toNaturalAmount(type: AccountType, signedBalance: number): number {
  switch (type) {
    case AccountType.ASSET:
    case AccountType.EXPENSE:
      return signedBalance;
    case AccountType.LIABILITY:
    case AccountType.EQUITY:
    case AccountType.REVENUE:
      return -signedBalance;
    default:
      return signedBalance;
  }
}

/**
 * The debit and credit that return an account holding `signedBalance` to zero.
 *
 * This is the whole of the closing-entry arithmetic. An account with a debit balance is closed by
 * crediting it and vice versa, whatever type it is and whatever sign it happens to carry — which is
 * why this takes a balance and not an account type. A contra-revenue account with a debit balance
 * and an expense account with a credit refund balance are handled by the same two lines, and
 * neither can be silently dropped by a filter that only expected one sign.
 */
export function closingSideFor(signedBalance: number): {
  debit: number;
  credit: number;
} {
  if (signedBalance > 0) return { debit: 0, credit: signedBalance };
  if (signedBalance < 0) return { debit: -signedBalance, credit: 0 };
  return { debit: 0, credit: 0 };
}
