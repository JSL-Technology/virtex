import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AccountGroup, PolicyField, SettingsSectionComponent } from '../../shared/settings-section.component';

/** QA M-09: this section said «En desarrollo». It edits the organization's real settings now. */
@Component({
  selector: 'app-accounting-settings-page',
  standalone: true,
  imports: [TranslateModule, RouterLink, SettingsSectionComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">{{ 'settings.pages.accounting.title' | translate }}</h1>
        <p class="s-header__subtitle">{{ 'settings.pages.accounting.set_default_accounts_posting_rules_your' | translate }}</p>
      </div>
      <app-settings-section section="accounting" [groups]="groups" [policies]="policies" />
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}.s-links{margin-top:1.5rem;font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountingSettingsPage {
  protected readonly groups: readonly AccountGroup[] = [
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
];
  protected readonly policies: readonly PolicyField[] = [
  {
    field: 'defaultPaymentTermDays',
    labelKey: 'settings.sections.fields.payment_term_days',
    helpKey: 'settings.sections.fields.payment_term_days_help',
    kind: 'integer',
    min: 0,
    max: 365
  }
];
}
