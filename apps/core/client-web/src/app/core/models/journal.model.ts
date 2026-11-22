import type { LocalizedName } from '@virtex/shared/types';
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
  /** The name in the languages other than the books' — `name` is the record, in the books language. */
  nameTranslations?: LocalizedName;
  code: string;
  type: JournalType;
  organizationId: string;
  /** One the product posts to by code (sales, payroll, depreciation…): its code is fixed. */
  isSystem?: boolean;
  /** Entries posted to it; once there is one, its code and type are part of history. */
  entryCount?: number;
}