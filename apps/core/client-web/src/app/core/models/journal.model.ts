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
  /** One the product posts to by code (sales, payroll, depreciation…): its code is fixed. */
  isSystem?: boolean;
  /** Entries posted to it; once there is one, its code and type are part of history. */
  entryCount?: number;
}