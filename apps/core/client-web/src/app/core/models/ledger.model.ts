export interface GeneralLedgerLine {
  id: string; // <-- AÑADIDO para el seguimiento en el @for
  date: string;
  reference: string; // <-- RENOMBRADO de 'entryNumber' a 'reference'
  description: string;
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

// app/core/models/ledger.model.ts
export interface Ledger {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}