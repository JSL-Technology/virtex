// app/core/models/account.model.ts

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

export type HierarchyType = 'LEGAL' | 'MANAGEMENT' | 'FISCAL';
export type RequiredDimension = 'COST_CENTER' | 'PROJECT' | 'SEGMENT';
export type BlockedSource = 'MANUAL' | 'SUB_LEDGER_AR' | 'SUB_LEDGER_AP' | 'SUB_LEDGER_INV';
export type GaapStandard = 'IFRS' | 'LOCAL_GAAP' | 'US_GAAP';

// La interfaz principal de la cuenta se mantiene sin cambios
export interface Account {
  id: string;
  code: string;
  name: string;
  description?: string;
  type: AccountType;
  category: AccountCategory;
  nature: AccountNature;
  balance: number;
  isActive: boolean;
  isSystemAccount: boolean;
  isPostable: boolean;
  createdAt: Date;
  updatedAt: Date;
  organizationId: string;
  parentId: string | null;
  children?: Account[];
  
  // Propiedades de UI que se añaden en el frontend
  level?: number;
  isExpanded?: boolean;
  hasChildren?: boolean;

  // Campos adicionales para el formulario
  statementMapping?: {
    balanceSheetCategory: string;
    incomeStatementCategory: string;
    cashFlowCategory: CashFlowCategory;
  };
  rules?: {
    requiresReconciliation: boolean;
    isCashOrBank: boolean;
    allowsIntercompany: boolean;
    isFxRevaluation: boolean;
    requiredDimensions: RequiredDimension[];
  };
  advanced?: {
    version: number;
    hierarchyType: string;
    effectiveFrom: Date;
    effectiveTo?: Date;
  };
}