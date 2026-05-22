export interface GeneralLedgerLine {
  id: string;
  date: string | Date;
  reference: string;
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
    code: string;
    name: string;
  };
  startDate: string;
  endDate: string;
}
