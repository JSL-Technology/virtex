import { Account } from '../models/account.model';

/**
 * Which accounts a picker may offer, and why the answer is not "all of them".
 *
 * ## The problem this solves
 *
 * A chart of accounts contains two very different kinds of account. Most are there to be posted to
 * by a person: rent, fuel, professional fees, a piece of equipment. A handful are **control
 * accounts** — Accounts Receivable, Accounts Payable, the VAT accounts, Cash — whose balance is
 * owned by a sub-ledger or by the tax engine, and which a person must never post to by hand: doing
 * so breaks the one reconciliation that proves the sub-ledger and the ledger agree.
 *
 * The vendor-bill form offered every postable expense or asset account, which meant it invited the
 * operator to charge a purchase to **Cash** or to **Accounts Receivable**. Neither is ever right,
 * and the second one silently corrupts the ageing report.
 *
 * `systemRole` is how the tenant's chart says which account plays which part, and it is already
 * what every automatic posting resolves against. Reading the same field here is what keeps the
 * pickers and the postings from disagreeing.
 */

/**
 * Roles a human must not charge a document line to.
 *
 * `INVENTORY` is deliberately NOT here: buying stock legitimately debits inventory, and that is a
 * line somebody types on a purchase. Everything else on this list is either money (settled by a
 * payment, not by a bill), a sub-ledger's control account, a tax account the engine owns, or an
 * equity account with a specific meaning that a manual charge would destroy.
 */
export const CONTROL_ACCOUNT_ROLES: ReadonlySet<string> = new Set([
  // Money: a bill creates a payable; paying it is a separate document.
  'CASH',
  'BANK',
  // Receivables sub-ledger.
  'ACCOUNTS_RECEIVABLE',
  'DOUBTFUL_ALLOWANCE',
  'WITHHOLDING_RECEIVABLE',
  'CUSTOMER_ADVANCES',
  // Payables sub-ledger — the credit side of the very document being written.
  'ACCOUNTS_PAYABLE',
  // Tax: posted by the tax engine from the rates on the lines, never typed.
  'TAX_RECEIVABLE',
  'TAX_PAYABLE',
  'EXCISE_TAX_PAYABLE',
  'WITHHOLDING_PAYABLE',
  'SERVICE_CHARGE_PAYABLE',
  // Equity with a defined meaning.
  'RETAINED_EARNINGS',
  'OPENING_BALANCE_EQUITY',
  // Posted by the processes that own them.
  'COST_OF_GOODS_SOLD',
  'INVENTORY_ADJUSTMENT',
  'ACCUMULATED_DEPRECIATION',
  'FOREX_GAIN_LOSS',
  'INFLATION_ADJUSTMENT',
  // Payroll: every one of these is posted by a payroll run.
  'SALARY_EXPENSE',
  'EMPLOYER_CONTRIBUTIONS_EXPENSE',
  'PAYROLL_NET_PAYABLE',
  'AFP_PAYABLE',
  'SFS_PAYABLE',
  'INFOTEP_PAYABLE',
  'PAYROLL_TAX_WITHHOLDING_PAYABLE',
]);

/** Postable, not blocked, and not a control account. The floor every picker stands on. */
export function isChargeable(account: Account): boolean {
  return (
    account.isPostable &&
    !account.isBlockedForPosting &&
    account.isActive &&
    !CONTROL_ACCOUNT_ROLES.has(account.systemRole ?? '')
  );
}

/**
 * The accounts a purchase line may be charged to.
 *
 * Expense and asset: a bill buys either something consumed now or something capitalised. Revenue,
 * liability and equity accounts are not a purchase, and offering them is how a supplier invoice
 * ends up credited to sales.
 */
export function chargeableExpenseAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter(
    (account) =>
      isChargeable(account) && (account.type === 'EXPENSE' || account.type === 'ASSET'),
  );
}

/**
 * The accounts a treasury bank account may be mapped onto.
 *
 * The inverse of the rule above: here a control role is exactly what is wanted, but only the money
 * ones. The picker offered every postable account, so a bank account could be pointed at Accounts
 * Receivable — after which every deposit would have debited what customers owe us.
 *
 * An asset account with no role at all is allowed: a tenant whose chart predates the role field
 * still has to be able to map their bank, and refusing them would make the screen unusable rather
 * than safe.
 */
export function bankLedgerAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter((account) => {
    if (!account.isPostable || account.isBlockedForPosting || !account.isActive) return false;
    if (account.type !== 'ASSET') return false;
    const role = account.systemRole ?? '';
    return role === '' || role === 'CASH' || role === 'BANK';
  });
}
