/**
 * What a business transition would do, before it does it.
 *
 * ## Why this exists
 *
 * In most mid-market ERPs, pressing "Emitir" is an act of faith. The user finds out what happened
 * after it happened: whether the period was open, whether a fiscal number was available, which
 * accounts moved. When something is wrong the remedy is an adjusting entry and an awkward
 * conversation with an auditor.
 *
 * An accountant who sees the journal entry before issuing, signs. That is the difference between a
 * tool that executes and one that is trusted with the numbers.
 *
 * ## Why it is computed by executing, not by re-deriving
 *
 * The obvious implementation is a second function that works out what WOULD happen. It is also the
 * wrong one: it is a second source of truth, and the moment the two drift the preview lies —
 * confidently, about money. The inventory of this codebase found that pattern six times over
 * (two routing tables, two chart-of-accounts services, two customer forms) and it failed the same
 * way each time.
 *
 * So the preview runs the REAL transition inside a transaction and rolls it back. What it reports
 * is not a prediction; it is what happened, undone. Postings, stock movements and the consumed
 * fiscal number are read back from the rows the real code wrote.
 *
 * Two properties make that safe here:
 *
 *  - Side effects that are not database writes — the e-CF submission, the domain events — are held
 *    by `after-commit.service.ts` until the transaction is durable, and a rollback discards them.
 *  - The transition's own entry point emits events only after its transaction commits, so calling
 *    the inner, manager-taking function never reaches them.
 */

export type PreconditionStatus = 'passed' | 'failed';

export interface Precondition {
  /** Stable machine code, so a screen can phrase it in its own words. */
  code: string;
  status: PreconditionStatus;
  /** Already translated for the request's language. */
  message: string;
  /**
   * Where the user goes to fix it. A failed precondition that does not say what to do about it is
   * only a more detailed way of saying no.
   */
  remedy?: { labelKey: string; route: string };
}

export interface LedgerEffectLine {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  description?: string;
}

export interface LedgerEffect {
  kind: 'ledger';
  titleKey: string;
  currencyCode: string;
  lines: LedgerEffectLine[];
  totalDebit: number;
  totalCredit: number;
}

export interface StockEffect {
  kind: 'stock';
  titleKey: string;
  movements: Array<{ productName: string; quantity: number; warehouseName?: string }>;
}

export interface SequenceEffect {
  kind: 'sequence';
  titleKey: string;
  /** The number this transition would consume. Shown because it is not reversible in practice. */
  value: string;
  documentType?: string;
}

export interface NoticeEffect {
  kind: 'notice';
  titleKey: string;
  params?: Record<string, unknown>;
}

export type TransitionEffect = LedgerEffect | StockEffect | SequenceEffect | NoticeEffect;

export interface TransitionPreview {
  /** True when the transition ran to completion inside the rolled-back transaction. */
  canExecute: boolean;
  preconditions: Precondition[];
  effects: TransitionEffect[];
}

/** Marker thrown to unwind the dry run once its effects have been read. */
export class DryRunComplete extends Error {
  constructor() {
    super('dry-run');
    this.name = 'DryRunComplete';
  }
}
