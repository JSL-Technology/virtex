// app/core/models/journal.model.ts
export enum JournalType {
  SALES = 'SALES',
  PURCHASES = 'PURCHASES',
  CASH = 'CASH',
  BANK = 'BANK',
  GENERAL = 'GENERAL',
}

export interface Journal {
  id: string;
  name: string;
  code: string;
  type: JournalType;
  organizationId: string;
}