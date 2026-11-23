import type { LocalizedName } from '@virtex/shared/types';
/** A book the company keeps (the general ledger's lines are in `general-ledger.model.ts`). */
export interface Ledger {
  id: string;
  name: string;
  /** The name in the languages other than the books' — `name` is the record, in the books language. */
  nameTranslations?: LocalizedName;
  description?: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}