export interface GeneralLedgerLine {
  id: string;
  date: string;
  /** The entry's number. */
  reference: string;
  /** The line's narrative as the books record it — the entry's, where the line has none. */
  description: string;
  /** The message it was written from, when the system wrote it: `vxNarrative` renders it. */
  descriptionKey?: string | null;
  descriptionParams?: Record<string, unknown> | null;
  debit: number | null;
  credit: number | null;
  balance: number;
}

export interface GeneralLedger {
  initialBalance: number;
  finalBalance: number;
  lines: GeneralLedgerLine[];
  account: {
    id: string;
    code: string;
    name: string;
  };
}