/**
 * Mirrors `shared/transitions/transition-preview.ts` on the server.
 *
 * Hand-written rather than generated because the shape is small and stable, and a generator is one
 * more thing that can be out of date without anybody noticing.
 */
export type PreconditionStatus = 'passed' | 'failed';

export interface Precondition {
  code: string;
  status: PreconditionStatus;
  /**
   * Catalogue key for the wording, with its parameters.
   *
   * The API used to send this already translated while `effects[].titleKey` in the same payload was
   * a key, so one response carried two contracts and the client had to know which was which. Both
   * are names now, and the sentence is built here, where the screen's language is.
   */
  messageKey: string;
  params?: Record<string, unknown>;
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
  canExecute: boolean;
  preconditions: Precondition[];
  effects: TransitionEffect[];
}
