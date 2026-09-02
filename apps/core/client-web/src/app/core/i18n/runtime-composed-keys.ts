/**
 * Catalogue groups whose leaf key is built at runtime, never written as a literal.
 *
 * Two very different tools need the same list and must not keep separate copies:
 *
 *  - `translation-coverage.spec.ts` asserts every value below exists in every language, because a
 *    key composed from a stored value cannot be found by scanning for string literals — which is
 *    how `USER.STATUS.INACTIVE` was missing from all three catalogues without anything noticing.
 *  - `tools/i18n/find-orphan-keys.mjs` treats them as USED, for exactly the same reason. Without
 *    this list it reports them as dead and, if pruned, deletes the keys whose absence is hardest
 *    to see: the badge that renders a stored English word because its translation is gone.
 *
 * A group belongs here when the code writes `` `PREFIX.${value}` `` rather than `'PREFIX.VALUE'`.
 * The values are the complete domain — the enum, the union, the server's own list — not a sample.
 */
export const RUNTIME_COMPOSED_KEYS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['USER.STATUS', ['PENDING', 'ACTIVE', 'INACTIVE', 'ARCHIVED', 'BLOCKED']],
  ['USER.ROLE', ['ADMINISTRATOR', 'MEMBER', 'SELLER', 'ACCOUNTANT', 'NO_ROLE']],

  // Stored values the client turns into keys. They are English words in the database and were
  // once rendered straight into the badge, which is how a Spanish screen said "Partially Paid".
  ['INVOICES.STATUS', ['DRAFT', 'PENDING', 'PAID', 'PARTIALLY_PAID', 'VOID', 'CREDIT_NOTE']],
  [
    'INVOICES.PAYMENT_METHOD',
    ['CASH', 'CHECK', 'CREDIT_CARD', 'DEBIT_CARD', 'CREDIT', 'BANK_TRANSFER', 'GIFT_CARD', 'SWAP', 'OTHER'],
  ],
  [
    'ACCOUNTING.JOURNAL_ENTRIES',
    ['STATUS_DRAFT', 'STATUS_PENDING_APPROVAL', 'STATUS_POSTED', 'STATUS_MODIFIED', 'STATUS_VOID', 'STATUS_REJECTED'],
  ],
  ['ACCOUNTING.PERIODS', ['STATUS_OPEN', 'STATUS_CLOSED']],
  [
    'ACCOUNTING.ACCOUNT_RECONCILIATION',
    ['STATUS_RECONCILED', 'STATUS_PENDING', 'STATUS_WITH_DIFFERENCES'],
  ],

  // Sent BY THE SERVER as `descriptionKey`, so no client file mentions them at all. The server's
  // own catalogue is checked by `messages.parity.spec.ts`; this side has to be checked here.
  [
    'ACCOUNTING.CHECKLIST.ITEMS',
    [
      'UNPOSTED_JOURNAL_ENTRIES',
      'UNAPPROVED_VENDOR_BILLS',
      'UNRECONCILED_BANK_TRANSACTIONS',
      'CURRENCY_REVALUATION',
      'FIXED_ASSETS_DEPRECIATION',
      'PENDING_APPROVALS',
    ],
  ],

  // Built from the toast's `type` in `toast.component.ts`.
  ['COMMON.TOAST', ['SUCCESS', 'ERROR', 'WARNING', 'INFO']],
  // `UserManagementPage.ask()` builds `DIALOG.<SECTION>.TITLE` and `.MESSAGE` from the action it
  // was handed, so these four sections are named nowhere a text search can find them.
  ['DIALOG.RESET_PASSWORD', ['TITLE', 'MESSAGE']],
  ['DIALOG.REVOKE_SESSION', ['TITLE', 'MESSAGE']],
  ['DIALOG.BLOCK_USER', ['TITLE', 'MESSAGE']],
  ['DIALOG.IMPERSONATE_USER', ['TITLE', 'MESSAGE']],

  // Quota names interpolated into the plan card from the plan's own `resource` field.
  [
    'REGISTER.STEPS.PLAN.RESOURCES',
    ['INVOICES', 'USERS', 'CUSTOMERS', 'SUPPLIERS', 'JOURNAL_ENTRIES', 'SUBSIDIARIES'],
  ],
];
