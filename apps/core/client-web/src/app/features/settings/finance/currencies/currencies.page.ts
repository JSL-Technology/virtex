import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AccountGroup, PolicyField, SettingsSectionComponent } from '../../shared/settings-section.component';

/** QA M-09: this section said «En desarrollo». It edits the organization's real settings now. */
@Component({
  selector: 'app-currencies-settings-page',
  standalone: true,
  imports: [TranslateModule, RouterLink, SettingsSectionComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">{{ 'settings.pages.currencies.title' | translate }}</h1>
        <p class="s-header__subtitle">{{ 'settings.pages.currencies.subtitle' | translate }}</p>
      </div>
      <app-settings-section section="currencies" [groups]="groups" [policies]="policies" [showBaseCurrency]="true" />
      <p class="s-links">{{ 'settings.sections.currencies_links' | translate }}
        <a routerLink="/masters/currencies">{{ 'settings.sections.go_currencies' | translate }}</a></p>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}.s-links{margin-top:1.5rem;font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CurrencySettingsPage {
  protected readonly groups: readonly AccountGroup[] = [
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
];
  protected readonly policies: readonly PolicyField[] = [
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
];
}
