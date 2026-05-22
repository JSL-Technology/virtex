

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