
import { AccountNature, AccountType, AccountCategory } from "../../chart-of-accounts/enums/account-enums";
import { AccountTemplateDto } from "../entities/coa-template.entity";


interface CoaTemplateDefinition {
  countryCode: string;
  accounts: AccountTemplateDto[];
}

export const usGaapCoaTemplate: CoaTemplateDefinition = {
  countryCode: 'US',
  accounts: [

    {
      segments: ['1000'], name: 'Assets', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: false,
      children: [
        {
          segments: ['1100'], name: 'Current Assets', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: false,
          children: [
            { segments: ['1110'], name: 'Cash and Cash Equivalents', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: true },
            { segments: ['1120'], name: 'Accounts Receivable', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: true },
            { segments: ['1130'], name: 'Inventory', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: true },
            { segments: ['1140'], name: 'Prepaid Expenses', type: AccountType.ASSET, category: AccountCategory.CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: true },
          ]
        },
        {
          segments: ['1200'], name: 'Non-current Assets', type: AccountType.ASSET, category: AccountCategory.NON_CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: false,
          children: [
            { segments: ['1210'], name: 'Property, Plant, and Equipment', type: AccountType.ASSET, category: AccountCategory.NON_CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: true },
            { segments: ['1220'], name: 'Accumulated Depreciation', type: AccountType.ASSET, category: AccountCategory.NON_CURRENT_ASSET, nature: AccountNature.CREDIT, isPostable: true },
            { segments: ['1230'], name: 'Intangible Assets', type: AccountType.ASSET, category: AccountCategory.NON_CURRENT_ASSET, nature: AccountNature.DEBIT, isPostable: true },
          ]
        }
      ]
    },

    {
      segments: ['2000'], name: 'Liabilities', type: AccountType.LIABILITY, category: AccountCategory.CURRENT_LIABILITY, nature: AccountNature.CREDIT, isPostable: false,
      children: [
          { segments: ['2100'], name: 'Current Liabilities', type: AccountType.LIABILITY, category: AccountCategory.CURRENT_LIABILITY, nature: AccountNature.CREDIT, isPostable: false,
              children: [
                  { segments: ['2110'], name: 'Accounts Payable', type: AccountType.LIABILITY, category: AccountCategory.CURRENT_LIABILITY, nature: AccountNature.CREDIT, isPostable: true },
                  { segments: ['2120'], name: 'Accrued Expenses', type: AccountType.LIABILITY, category: AccountCategory.CURRENT_LIABILITY, nature: AccountNature.CREDIT, isPostable: true },
                  { segments: ['2130'], name: 'Sales Tax Payable', type: AccountType.LIABILITY, category: AccountCategory.CURRENT_LIABILITY, nature: AccountNature.CREDIT, isPostable: true },
              ]
          }
      ]
    },

    {
        segments: ['3000'], name: 'Equity', type: AccountType.EQUITY, category: AccountCategory.OWNERS_EQUITY, nature: AccountNature.CREDIT, isPostable: false,
        children: [
            { segments: ['3100'], name: 'Common Stock', type: AccountType.EQUITY, category: AccountCategory.OWNERS_EQUITY, nature: AccountNature.CREDIT, isPostable: true },
            { segments: ['3200'], name: 'Retained Earnings', type: AccountType.EQUITY, category: AccountCategory.RETAINED_EARNINGS, nature: AccountNature.CREDIT, isPostable: true },
        ]
    },

    {
        segments: ['4000'], name: 'Revenue', type: AccountType.REVENUE, category: AccountCategory.OPERATING_REVENUE, nature: AccountNature.CREDIT, isPostable: false,
        children: [
            { segments: ['4100'], name: 'Sales Revenue', type: AccountType.REVENUE, category: AccountCategory.OPERATING_REVENUE, nature: AccountNature.CREDIT, isPostable: true },
        ]
    },

    {
        segments: ['5000'], name: 'Expenses', type: AccountType.EXPENSE, category: AccountCategory.OPERATING_EXPENSE, nature: AccountNature.DEBIT, isPostable: false,
        children: [
            { segments: ['5100'], name: 'Cost of Goods Sold', type: AccountType.EXPENSE, category: AccountCategory.COST_OF_GOODS_SOLD, nature: AccountNature.DEBIT, isPostable: true },
            { segments: ['5200'], name: 'Salaries and Wages', type: AccountType.EXPENSE, category: AccountCategory.OPERATING_EXPENSE, nature: AccountNature.DEBIT, isPostable: true },
            { segments: ['5300'], name: 'Rent Expense', type: AccountType.EXPENSE, category: AccountCategory.OPERATING_EXPENSE, nature: AccountNature.DEBIT, isPostable: true },
        ]
    }
  ],
};