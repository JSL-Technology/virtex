
import { AccountNature, AccountType, AccountCategory } from "../../chart-of-accounts/enums/account-enums";



export const panamaCoaTemplate = {
  countryCode: 'PA',
  accounts: [

    {
      code: '1',
      name: 'Activos',
      type: AccountType.ASSET,
      category: AccountCategory.CURRENT_ASSET,
      nature: AccountNature.DEBIT,
      isPostable: false,
      children: [
        {
          code: '110',
          name: 'Activos Corrientes',
          type: AccountType.ASSET,
          category: AccountCategory.CURRENT_ASSET,
          nature: AccountNature.DEBIT,
          isPostable: false,
          children: [
            { code: '110-01', name: 'Efectivo y Equivalentes', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: true },
            { code: '110-02', name: 'Cuentas por Cobrar', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: true },
            { code: '110-03', name: 'Inventario', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: true },
          ]
        },
      ],
    },

    {
      code: '2',
      name: 'Pasivos',
      type: AccountType.LIABILITY,
      category: AccountCategory.CURRENT_LIABILITY,
      nature: AccountNature.CREDIT,
      isPostable: false,
      children: [
        {
          code: '210',
          name: 'Pasivos Corrientes',
          type: AccountType.LIABILITY,
          category: AccountCategory.CURRENT_LIABILITY,
          nature: AccountNature.CREDIT,
          isPostable: false,
          children: [
            { code: '210-01', name: 'Cuentas por Pagar', type: AccountType.LIABILITY, category: AccountCategory.CURRENT_LIABILITY, nature: AccountNature.CREDIT, isPostable: true },
            { code: '210-02', name: 'ITBMS por Pagar', type: AccountType.LIABILITY, category: AccountCategory.CURRENT_LIABILITY, nature: AccountNature.CREDIT, isPostable: true },
          ],
        }
      ],
    },

    {
        code: '3',
        name: 'Patrimonio',
        type: AccountType.EQUITY,
        category: AccountCategory.OWNERS_EQUITY,
        nature: AccountNature.CREDIT,
        isPostable: false,
        children: [
            { code: '310-01', name: 'Capital Social', type: AccountType.EQUITY, category: AccountCategory.OWNERS_EQUITY, nature: AccountNature.CREDIT, isPostable: true },
            { code: '310-02', name: 'Resultados Acumulados', type: AccountType.EQUITY, category: AccountCategory.RETAINED_EARNINGS, nature: AccountNature.CREDIT, isPostable: true },
        ]
    },

    {
        code: '4',
        name: 'Ingresos',
        type: AccountType.REVENUE,
        category: AccountCategory.OPERATING_REVENUE,
        nature: AccountNature.CREDIT,
        isPostable: false,
        children: [
            { code: '410-01', name: 'Ventas de Mercancía', type: AccountType.REVENUE, category: AccountCategory.OPERATING_REVENUE, nature: AccountNature.CREDIT, isPostable: true },
        ]
    },

    {
        code: '5',
        name: 'Gastos',
        type: AccountType.EXPENSE,
        category: AccountCategory.OPERATING_EXPENSE,
        nature: AccountNature.DEBIT,
        isPostable: false,
        children: [
            { code: '510-01', name: 'Gastos de Salarios', type: AccountType.EXPENSE, category: AccountCategory.OPERATING_EXPENSE, nature: AccountNature.DEBIT, isPostable: true },
            { code: '510-02', name: 'Gastos de Alquiler', type: AccountType.EXPENSE, category: AccountCategory.OPERATING_EXPENSE, nature: AccountNature.DEBIT, isPostable: true },
        ]
    }
  ],
};