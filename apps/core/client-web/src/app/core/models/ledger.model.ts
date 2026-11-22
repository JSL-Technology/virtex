/** A book the company keeps (the general ledger's lines are in `general-ledger.model.ts`). */
export interface Ledger {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}