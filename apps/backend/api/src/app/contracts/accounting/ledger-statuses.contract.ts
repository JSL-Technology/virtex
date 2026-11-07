/**
 * The journal-entry statuses whose lines count towards balances.
 *
 * Shared vocabulary: every module that READS the ledger (reports, budgets, dashboards, fiscal
 * exports, analytics) must agree on it, and most of them may not import accounting. The values
 * mirror `JournalEntryStatus`; `journal-entry.entity.ts` asserts at compile time that they do.
 *
 * Why MODIFIED counts: modifying a posted entry posts a reversal and a replacement, and the
 * original stays in the books as the fact it was. Counting only POSTED excluded the original while
 * counting its reversal — every modification subtracted the amount twice (audit 2026-10-31, GL-01).
 */
export const LEDGER_STATUS_VALUES = ['Posted', 'Modified'] as const;
export type LedgerStatus = (typeof LEDGER_STATUS_VALUES)[number];

/** The same set as an SQL list, for raw queries and view definitions. */
export const LEDGER_STATUSES_SQL = `(${LEDGER_STATUS_VALUES.map((value) => `'${value}'`).join(', ')})`;
