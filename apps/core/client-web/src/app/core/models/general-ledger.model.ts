export interface GeneralLedgerLine {
  id: string; // <-- AÑADIDO: Necesario para 'track' en el bucle @for
  date: string;
  reference: string; // <-- RENOMBRADO: de 'entryNumber' a 'reference' para que coincida con el HTML
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