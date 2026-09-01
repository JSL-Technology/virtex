

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



export const AccountTypeTranslations = {
    [AccountType.ASSET]: { en: 'Asset', es: 'Activo' },
    [AccountType.LIABILITY]: { en: 'Liability', es: 'Pasivo' },
    [AccountType.EQUITY]: { en: 'Equity', es: 'Patrimonio' },
    [AccountType.REVENUE]: { en: 'Revenue', es: 'Ingresos' },
    [AccountType.EXPENSE]: { en: 'Expense', es: 'Gastos' },
};

export const AccountCategoryTranslations = {

    [AccountCategory.CURRENT_ASSET]: { en: 'Current Asset', es: 'Activo Corriente' },
    [AccountCategory.NON_CURRENT_ASSET]: { en: 'Non-Current Asset', es: 'Activo No Corriente' },


    [AccountCategory.CURRENT_LIABILITY]: { en: 'Current Liability', es: 'Pasivo Corriente' },
    [AccountCategory.NON_CURRENT_LIABILITY]: { en: 'Non-Current Liability', es: 'Pasivo No Corriente' },


    [AccountCategory.OWNERS_EQUITY]: { en: 'Owner\'s Equity', es: 'Patrimonio de Propietarios' },
    [AccountCategory.RETAINED_EARNINGS]: { en: 'Retained Earnings', es: 'Ganancias Retenidas' },


    [AccountCategory.OPERATING_REVENUE]: { en: 'Operating Revenue', es: 'Ingresos Operativos' },
    [AccountCategory.NON_OPERATING_REVENUE]: { en: 'Non-Operating Revenue', es: 'Ingresos No Operativos' },


    [AccountCategory.OPERATING_EXPENSE]: { en: 'Operating Expense', es: 'Gasto Operativo' },
    [AccountCategory.NON_OPERATING_EXPENSE]: { en: 'Non-Operating Expense', es: 'Gasto No Operativo' },
    [AccountCategory.COST_OF_GOODS_SOLD]: { en: 'Cost of Goods Sold', es: 'Costo de Bienes Vendidos' },
};



export enum CashFlowCategory {
    OPERATING = 'OPERATING',
    INVESTING = 'INVESTING',
    FINANCING = 'FINANCING',
    NONE = 'NONE',
}

export enum RequiredDimension {
    COST_CENTER = 'COST_CENTER',
    PROJECT = 'PROJECT',
    SEGMENT = 'SEGMENT',
}

export enum HierarchyType {
    LEGAL = 'LEGAL',
    MANAGEMENT = 'MANAGEMENT',
    FISCAL = 'FISCAL',
}
/**
 * The operational job an account does, independent of its name, its code and the language it was
 * created in.
 *
 * Every automatic posting in the product — a sale, a collection, a purchase, a depreciation run —
 * needs to reach a specific account, and until now the only ways to find one were its localized
 * name or a hardcoded code. Both break the moment a tenant renames an account, translates its
 * chart, or imports a statutory plan whose codes differ (Colombia's PUC writes `1305`, not `1130`).
 *
 * The role is stamped by the chart-of-accounts template at provisioning time and is unique per
 * organization, so `OrganizationSettings` is derived from it deterministically rather than guessed.
 * A tenant may re-point a role to a different account; what it cannot do is leave the product
 * without one and discover it at the moment of issuing an invoice.
 */
export enum AccountRole {
  CASH = 'CASH',
  BANK = 'BANK',
  ACCOUNTS_RECEIVABLE = 'ACCOUNTS_RECEIVABLE',
  DOUBTFUL_ALLOWANCE = 'DOUBTFUL_ALLOWANCE',
  INVENTORY = 'INVENTORY',
  /** VAT/ITBIS/IVA borne on purchases — the credit side of the tax return. */
  TAX_RECEIVABLE = 'TAX_RECEIVABLE',
  /** Tax withheld from us by our customers, recoverable against the return. */
  WITHHOLDING_RECEIVABLE = 'WITHHOLDING_RECEIVABLE',
  ACCOUNTS_PAYABLE = 'ACCOUNTS_PAYABLE',
  /** VAT/ITBIS/IVA charged on sales — the debit side of the tax return. */
  TAX_PAYABLE = 'TAX_PAYABLE',
  /** Tax we withhold from third parties and must remit. */
  WITHHOLDING_PAYABLE = 'WITHHOLDING_PAYABLE',
  /** Legally mandated service charge (propina legal in DO/CR): collected for staff, never revenue. */
  SERVICE_CHARGE_PAYABLE = 'SERVICE_CHARGE_PAYABLE',
  RETAINED_EARNINGS = 'RETAINED_EARNINGS',
  SALES_REVENUE = 'SALES_REVENUE',
  SERVICE_REVENUE = 'SERVICE_REVENUE',
  SALES_DISCOUNTS = 'SALES_DISCOUNTS',
  COST_OF_GOODS_SOLD = 'COST_OF_GOODS_SOLD',
  ACCUMULATED_DEPRECIATION = 'ACCUMULATED_DEPRECIATION',
  DEPRECIATION_EXPENSE = 'DEPRECIATION_EXPENSE',
  FOREX_GAIN_LOSS = 'FOREX_GAIN_LOSS',
  INFLATION_ADJUSTMENT = 'INFLATION_ADJUSTMENT',
}
