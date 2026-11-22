// app/core/models/account.model.ts
import type { FxTreatment } from '@virtex/shared/types';

// --- TIPOS ENUMERADOS (ENUM TYPES) ---
// Se cambian a 'enum' para que existan en tiempo de ejecución y se puedan iterar.

export enum AccountType {
    ASSET = 'ASSET',
    LIABILITY = 'LIABILITY',
    EQUITY = 'EQUITY',
    REVENUE = 'REVENUE',
    EXPENSE = 'EXPENSE',
}

export enum AccountNature {
    DEBIT = 'DEBIT',
    CREDIT = 'CREDIT',
}

export enum AccountCategory {
    CURRENT_ASSET = 'CURRENT_ASSET',
    NON_CURRENT_ASSET = 'NON_CURRENT_ASSET',
    CURRENT_LIABILITY = 'CURRENT_LIABILITY',
    NON_CURRENT_LIABILITY = 'NON_CURRENT_LIABILITY',
    OWNERS_EQUITY = 'OWNERS_EQUITY',
    RETAINED_EARNINGS = 'RETAINED_EARNINGS',
    OPERATING_REVENUE = 'OPERATING_REVENUE',
    NON_OPERATING_REVENUE = 'NON_OPERATING_REVENUE',
    OPERATING_EXPENSE = 'OPERATING_EXPENSE',
    NON_OPERATING_EXPENSE = 'NON_OPERATING_EXPENSE',
    COST_OF_GOODS_SOLD = 'COST_OF_GOODS_SOLD',
}

export enum CashFlowCategory {
    OPERATING = 'OPERATING',
    INVESTING = 'INVESTING',
    FINANCING = 'FINANCING',
    NONE = 'NONE',
}

export interface Account {
  id: string;
  code: string;
  /**
   * The server stores the name as a translation map — `{ es: 'Efectivo', en: 'Cash' }` — and sends
   * it that way. Typed as a plain string here, every account picker that interpolated it printed
   * `[object Object]`.
   */
  name: string | Record<string, string>;
  description?: string | Record<string, string>;
  type: AccountType;
  category: AccountCategory;
  nature: AccountNature;
  balance: number;
  isActive: boolean;
  isSystemAccount: boolean;
  isPostable: boolean;
  /** Blocked accounts are refused by the posting service; a picker should not offer them. */
  isBlockedForPosting?: boolean;
  isContraAccount?: boolean;
  systemRole?: string | null;
  createdAt: Date;
  updatedAt: Date;
  organizationId: string;
  parentId: string | null;
  children?: Account[];
  
  // Propiedades de UI que se añaden en el frontend
  level?: number;
  isExpanded?: boolean;
  hasChildren?: boolean;

  /**
   * How the account's foreign-currency balances are measured at each period end (IAS 21): restated
   * at the closing rate, or kept at their historical rate. Only balance-sheet accounts are revalued.
   */
  fxTreatment: FxTreatment;
  /** ISO 4217. Set: every line on the account is in this currency. Null: lines in any currency. */
  currency?: string | null;
  /** Restated for inflation (IAS 29): only a postable non-monetary account can be. */
  isInflationAdjustable?: boolean;
  /** Where its restatement is posted when the account stays at nominal value (capital → «Ajuste de capital»). */
  inflationAdjustmentAccountId?: string | null;
  effectiveFrom?: string;
  effectiveTo?: string | null;

  statementMapping?: {
    balanceSheetCategory?: string;
    incomeStatementCategory?: string;
    cashFlowCategory?: CashFlowCategory;
  };
}
