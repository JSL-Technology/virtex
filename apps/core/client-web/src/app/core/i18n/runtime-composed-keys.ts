/**
 * Catalogue groups whose leaf key is built at runtime, never written as a literal.
 *
 * Two very different tools need the same list and must not keep separate copies:
 *
 *  - `translation-coverage.spec.ts` asserts every value below exists in every language, because a
 *    key composed from a stored value cannot be found by scanning for string literals — which is
 *    how `user.status.inactive` was missing from all three catalogues without anything noticing.
 *  - `tools/i18n/find-orphan-keys.mjs` treats them as USED, for exactly the same reason. Without
 *    this list it reports them as dead and, if pruned, deletes the keys whose absence is hardest
 *    to see: the badge that renders a stored English word because its translation is gone.
 *
 * A group belongs here when the code writes `` `PREFIX.${value}` `` rather than `'PREFIX.VALUE'`.
 * The values are the complete domain — the enum, the union, the server's own list — not a sample.
 */
export const RUNTIME_COMPOSED_KEYS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['user.status', ['PENDING', 'ACTIVE', 'INACTIVE', 'ARCHIVED', 'BLOCKED']],
  ['user.role', ['ADMINISTRATOR', 'MEMBER', 'SELLER', 'ACCOUNTANT', 'NO_ROLE']],

  // Stored values the client turns into keys. They are English words in the database and were
  // once rendered straight into the badge, which is how a Spanish screen said "Partially Paid".
  ['invoices.status', ['DRAFT', 'PENDING', 'PAID', 'PARTIALLY_PAID', 'VOID', 'CREDIT_NOTE']],
  [
    'invoices.payment_method',
    ['CASH', 'CHECK', 'CREDIT_CARD', 'DEBIT_CARD', 'CREDIT', 'BANK_TRANSFER', 'GIFT_CARD', 'SWAP', 'OTHER'],
  ],
  [
    'accounting.journal_entries',
    ['STATUS_DRAFT', 'STATUS_PENDING_APPROVAL', 'STATUS_POSTED', 'STATUS_MODIFIED', 'STATUS_VOID', 'STATUS_REJECTED'],
  ],
  ['accounting.periods', ['STATUS_OPEN', 'STATUS_CLOSED']],
  ['customer_receipts.status', ['POSTED', 'VOID']],
  [
    'accounts_payable.status',
    ['DRAFT', 'PENDING_APPROVAL', 'OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID', 'REJECTED'],
  ],
  ['customer_receipts.method', ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER']],
  // The bank statement's own lifecycle, composed from `StatementStatus` in the reconciliation
  // workbench. It replaces `ACCOUNTING.ACCOUNT_RECONCILIATION.STATUS_*`, which described the
  // three states of a table that listed accounts from a signal nothing ever populated.
  [
    'accounting.reconciliation.status',
    ['IMPORTING', 'IMPORTED', 'FAILED', 'RECONCILED'],
  ],
  [
    'accounting.categories',
    [
      'CURRENT_ASSET',
      'NON_CURRENT_ASSET',
      'CURRENT_LIABILITY',
      'NON_CURRENT_LIABILITY',
      'OWNERS_EQUITY',
      'RETAINED_EARNINGS',
      'OPERATING_REVENUE',
      'NON_OPERATING_REVENUE',
      'OPERATING_EXPENSE',
      'NON_OPERATING_EXPENSE',
      'COST_OF_GOODS_SOLD',
      'CASH',
    ],
  ],

  // Sent BY THE SERVER as `descriptionKey`, so no client file mentions them at all. The server's
  // own catalogue is checked by `messages.parity.spec.ts`; this side has to be checked here.
  [
    'accounting.checklist.items',
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
  ['common.toast', ['SUCCESS', 'ERROR', 'WARNING', 'INFO']],
  // `UserManagementPage.ask()` builds `DIALOG.<SECTION>.TITLE` and `.MESSAGE` from the action it
  // was handed, so these four sections are named nowhere a text search can find them.
  ['dialog.reset_password', ['TITLE', 'MESSAGE']],
  ['dialog.revoke_session', ['TITLE', 'MESSAGE']],
  ['dialog.block_user', ['TITLE', 'MESSAGE']],
  ['dialog.impersonate_user', ['TITLE', 'MESSAGE']],

  // Quota names interpolated into the plan card from the plan's own `resource` field.
  [
    'register.steps.plan.resources',
    ['INVOICES', 'USERS', 'CUSTOMERS', 'SUPPLIERS', 'JOURNAL_ENTRIES', 'SUBSIDIARIES'],
  ],

  // The extensions manager composes both from the API's own enums: the catalogue row's status and
  // the sandbox run's outcome. Both used to be printed raw — the reader saw `REVOKED` and
  // `execution_failed`, in English, in every language.
  ['extensions.status', ['ACTIVE', 'DISABLED', 'REVOKED']],
  ['extensions.run_status', ['success', 'execution_failed']],

  // `dialog.delete_folder` / `dialog.delete_document` are chosen by the document repository from
  // the node's kind, so neither full key is written out anywhere.
  ['dialog.delete_folder', ['TITLE', 'MESSAGE']],
  ['dialog.delete_document', ['TITLE', 'MESSAGE']],

  /**
   * Every Dominican comprobante type, by its DGII code.
   *
   * The server composes `FISCAL.DO.<code>` from `NcfType` and the fiscal settings screen builds the
   * same key from its own list, so no full key is written anywhere a literal scan can see. Four of
   * the sixteen were missing — `E41`, `E43`, `E47` and `B03` — and the screen that registers NCF
   * ranges showed `[[fiscal.do.e41]]` in the dropdown a tenant picks their comprobante from.
   */
  [
    'fiscal.do',
    [
      'B01', 'B02', 'B03', 'B04', 'B11', 'B15',
      'E31', 'E32', 'E33', 'E34', 'E41', 'E43', 'E44', 'E45', 'E46', 'E47',
    ],
  ],
];
