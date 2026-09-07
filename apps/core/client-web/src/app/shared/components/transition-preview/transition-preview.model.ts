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
  message: string;
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
