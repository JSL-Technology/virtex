import { AccountGroup, PolicyField } from '../shared/settings-section.component';
import { SettingsSectionId } from '../data/organization-settings.service';

/**
 * What each settings row section holds: its default accounts and its policies.
 *
 * These used to be six pages, one per row section (accounting, currencies, taxes, closing,
 * intercompany, inventory), each mixing a few accounts with a few policies — two fields in
 * «Intercompany», one account in «Closing». Reviewing the chart of default accounts meant opening
 * six sections and saving six times. The declarations stay per row section, because that is how
 * the API saves them; the screens now group them by what they are: «Default accounts» and
 * «Accounting and tax policies».
 */
export interface SectionDeclaration {
  /** The row section the API saves these under. */
  section: SettingsSectionId;
  /** The anchor old ids lead to (`#settings/inventory-policies` → `inventory`). */
  anchor: string;
  /** The heading of this block on the combined screens. */
  titleKey: string;
  groups: readonly AccountGroup[];
  policies: readonly PolicyField[];
}

export const SECTION_DECLARATIONS: readonly SectionDeclaration[] = [
  {
    section: 'accounting',
    anchor: 'sales',
    titleKey: 'settings.declarations.accounting',
    groups: [
      {
        titleKey: 'settings.sections.groups.sales',
        fields: [
          {
            field: 'defaultAccountsReceivableId',
            labelKey: 'settings.sections.fields.accounts_receivable',
            helpKey: 'settings.sections.fields.accounts_receivable_help'
          },
          {
            field: 'defaultSalesRevenueId',
            labelKey: 'settings.sections.fields.sales_revenue'
          },
          {
            field: 'defaultServiceRevenueId',
            labelKey: 'settings.sections.fields.service_revenue'
          },
          {
            field: 'defaultSalesDiscountsId',
            labelKey: 'settings.sections.fields.sales_discounts'
          },
          {
            field: 'defaultCustomerAdvancesAccountId',
            labelKey: 'settings.sections.fields.customer_advances_account',
            helpKey: 'settings.sections.fields.customer_advances_account_help'
          }
        ]
      },
      {
        titleKey: 'settings.sections.groups.purchases',
        fields: [
          {
            field: 'defaultAccountsPayableId',
            labelKey: 'settings.sections.fields.accounts_payable'
          }
        ]
      },
      {
        titleKey: 'settings.sections.groups.cash',
        fields: [
          {
            field: 'defaultCashId',
            labelKey: 'settings.sections.fields.cash'
          },
          {
            field: 'defaultBankId',
            labelKey: 'settings.sections.fields.bank'
          },
          {
            field: 'defaultBankFeesAccountId',
            labelKey: 'settings.sections.fields.bank_fees_account'
          }
        ]
      },
      {
        titleKey: 'settings.sections.groups.assets_equity',
        fields: [
          {
            field: 'defaultDepreciationExpenseAccountId',
            labelKey: 'settings.sections.fields.depreciation_expense_account'
          },
          {
            field: 'defaultAccumulatedDepreciationAccountId',
            labelKey: 'settings.sections.fields.accumulated_depreciation_account'
          },
          {
            field: 'defaultOpeningBalanceEquityAccountId',
            labelKey: 'settings.sections.fields.opening_balance_equity_account',
            helpKey: 'settings.sections.fields.opening_balance_equity_account_help'
          },
          {
            field: 'defaultInflationAdjustmentAccountId',
            labelKey: 'settings.sections.fields.inflation_adjustment_account',
            helpKey: 'settings.sections.fields.inflation_adjustment_account_help'
          }
        ]
      }
    ],
    policies: [
      {
        field: 'defaultPaymentTermDays',
        labelKey: 'settings.sections.fields.payment_term_days',
        helpKey: 'settings.sections.fields.payment_term_days_help',
        kind: 'integer',
        min: 0,
        max: 365
      }
    ],
  },
  {
    section: 'currencies',
    anchor: 'currency',
    titleKey: 'settings.declarations.currency',
    groups: [
      {
        titleKey: 'settings.sections.groups.fx',
        fields: [
          {
            field: 'defaultForexGainLossAccountId',
            labelKey: 'settings.sections.fields.forex_gain_loss_account',
            helpKey: 'settings.sections.fields.forex_gain_loss_account_help'
          }
        ]
      }
    ],
    policies: [
      {
        field: 'exchangeRateType',
        labelKey: 'settings.sections.fields.exchange_rate_type',
        helpKey: 'settings.sections.fields.exchange_rate_type_help',
        kind: 'select',
        options: [
          'OFFICIAL',
          'MARKET',
          'BUY',
          'SELL'
        ],
        optionPrefix: 'settings.sections.rate_type.'
      },
      {
        field: 'fxRateMaxAgeDays',
        labelKey: 'settings.sections.fields.fx_rate_max_age_days',
        helpKey: 'settings.sections.fields.fx_rate_max_age_days_help',
        kind: 'integer',
        min: 0,
        max: 90
      },
      {
        field: 'fxRateTolerance',
        labelKey: 'settings.sections.fields.fx_rate_tolerance',
        helpKey: 'settings.sections.fields.fx_rate_tolerance_help',
        kind: 'percent',
        min: 0,
        max: 25
      }
    ],
  },
  {
    section: 'taxes',
    anchor: 'taxes',
    titleKey: 'settings.declarations.taxes',
    groups: [
      {
        titleKey: 'settings.sections.groups.tax_accounts',
        fields: [
          {
            field: 'defaultSalesTaxId',
            labelKey: 'settings.sections.fields.sales_tax'
          },
          {
            field: 'defaultPurchaseTaxId',
            labelKey: 'settings.sections.fields.purchase_tax',
            helpKey: 'settings.sections.fields.purchase_tax_help'
          },
          {
            field: 'defaultTaxWithheldReceivableId',
            labelKey: 'settings.sections.fields.tax_withheld_receivable',
            helpKey: 'settings.sections.fields.tax_withheld_receivable_help'
          },
          {
            field: 'defaultTaxWithheldPayableId',
            labelKey: 'settings.sections.fields.tax_withheld_payable',
            helpKey: 'settings.sections.fields.tax_withheld_payable_help'
          },
          {
            field: 'defaultExciseTaxPayableId',
            labelKey: 'settings.sections.fields.excise_tax_payable'
          },
          {
            field: 'defaultServiceChargePayableId',
            labelKey: 'settings.sections.fields.service_charge_payable'
          }
        ]
      }
    ],
    policies: [
      {
        field: 'taxpayerType',
        labelKey: 'settings.sections.fields.taxpayer_type',
        helpKey: 'settings.sections.fields.taxpayer_type_help',
        kind: 'select',
        options: [
          'COMPANY',
          'INDIVIDUAL',
          'WITHHOLDING_AGENT',
          'GOVERNMENT',
          'FOREIGN'
        ],
        optionPrefix: 'settings.sections.taxpayer_type.',
        nullable: true
      }
    ],
  },
  {
    section: 'closing',
    anchor: 'closing',
    titleKey: 'settings.declarations.closing',
    groups: [
      {
        titleKey: 'settings.sections.groups.closing',
        fields: [
          {
            field: 'defaultRetainedEarningsAccountId',
            labelKey: 'settings.sections.fields.retained_earnings_account',
            helpKey: 'settings.sections.fields.retained_earnings_account_help'
          }
        ]
      }
    ],
    policies: [
      {
        field: 'fiscalArchiveAfterYears',
        labelKey: 'settings.sections.fields.fiscal_archive_after_years',
        helpKey: 'settings.sections.fields.fiscal_archive_after_years_help',
        kind: 'integer',
        min: 5,
        max: 30
      }
    ],
  },
  {
    section: 'intercompany',
    anchor: 'intercompany',
    titleKey: 'settings.declarations.intercompany',
    groups: [
      {
        titleKey: 'settings.sections.groups.intercompany',
        fields: [
          {
            field: 'defaultIntercompanyReceivableAccountId',
            labelKey: 'settings.sections.fields.intercompany_receivable_account',
            helpKey: 'settings.sections.fields.intercompany_receivable_account_help'
          },
          {
            field: 'defaultIntercompanyPayableAccountId',
            labelKey: 'settings.sections.fields.intercompany_payable_account',
            helpKey: 'settings.sections.fields.intercompany_payable_account_help'
          }
        ]
      }
    ],
    policies: [],
  },
  {
    section: 'inventory',
    anchor: 'inventory',
    titleKey: 'settings.declarations.inventory',
    groups: [
      {
        titleKey: 'settings.sections.groups.inventory',
        fields: [
          {
            field: 'defaultInventoryId',
            labelKey: 'settings.sections.fields.inventory'
          },
          {
            field: 'defaultCostOfGoodsSoldId',
            labelKey: 'settings.sections.fields.cost_of_goods_sold'
          },
          {
            field: 'defaultInventoryAdjustmentAccountId',
            labelKey: 'settings.sections.fields.inventory_adjustment_account',
            helpKey: 'settings.sections.fields.inventory_adjustment_account_help'
          },
          {
            field: 'defaultGoodsReceivedNotInvoicedAccountId',
            labelKey: 'settings.sections.fields.goods_received_not_invoiced_account',
            helpKey: 'settings.sections.fields.goods_received_not_invoiced_account_help'
          }
        ]
      }
    ],
    policies: [],
  },
];
