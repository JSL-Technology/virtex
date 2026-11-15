/**
 * Accounts payable and receivable, treasury and bank reconciliation.
 *
 * These four modules carried no permission at all: 59 of 85 finance routes were reachable by any
 * authenticated member of the tenant. That included moving funds between accounts, uploading and
 * reconciling a bank statement, approving and voiding supplier invoices, running the year-end
 * close, and editing the chart of accounts. The irony was that manual journal entries were fully
 * protected while recurring entries — which the scheduler posts unattended — were not, so the
 * control on posting was bypassed by scheduling one.
 */
export const FINANCE_PERMISSIONS = {
  ACCOUNTS_PAYABLE_VIEW: 'accounts_payable:view',
  ACCOUNTS_PAYABLE_CREATE: 'accounts_payable:create',
  ACCOUNTS_PAYABLE_EDIT: 'accounts_payable:edit',
  ACCOUNTS_PAYABLE_APPROVE: 'accounts_payable:approve',
  ACCOUNTS_PAYABLE_VOID: 'accounts_payable:void',
  ACCOUNTS_PAYABLE_PAY: 'accounts_payable:pay',

  ACCOUNTS_RECEIVABLE_VIEW: 'accounts_receivable:view',
  ACCOUNTS_RECEIVABLE_COLLECT: 'accounts_receivable:collect',
  ACCOUNTS_RECEIVABLE_VOID: 'accounts_receivable:void',

  /**
   * Collections: the worklist of who to chase first, and what was done about it. Reading it also
   * needs `accounts_receivable:view` — the worklist is the receivables book, ranked.
   *
   * It was `ai_collections:view` / `ai_collections:act`, catalogued as AI, and the routes sat behind
   * the AI plan feature: a company on the entry plan had no collections at all (TES-13). Only the
   * note the assistant writes is AI, and that is what the `ai_collections` feature gates now.
   */
  COLLECTIONS_VIEW: 'collections:view',
  /** Recording calls and promises, and sending reminders to customers. */
  COLLECTIONS_ACT: 'collections:act',

  TREASURY_VIEW: 'treasury:view',
  TREASURY_MANAGE_ACCOUNTS: 'treasury:manage_accounts',
  TREASURY_TRANSFER: 'treasury:transfer',

  RECONCILIATION_VIEW: 'reconciliation:view',
  RECONCILIATION_IMPORT: 'reconciliation:import',
  RECONCILIATION_MATCH: 'reconciliation:match',
  RECONCILIATION_MANAGE_RULES: 'reconciliation:manage_rules',

  BUDGETS_VIEW: 'budgets:view',
  BUDGETS_MANAGE: 'budgets:manage',
  FINANCIALS_CONSOLIDATE: 'financials:consolidate',
} as const;
