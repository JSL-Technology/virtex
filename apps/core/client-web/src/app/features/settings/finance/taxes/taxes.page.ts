import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AccountGroup, PolicyField, SettingsSectionComponent } from '../../shared/settings-section.component';

/** QA M-09: this section said «En desarrollo». It edits the organization's real settings now. */
@Component({
  selector: 'app-taxes-settings-page',
  standalone: true,
  imports: [TranslateModule, RouterLink, SettingsSectionComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">{{ 'settings.pages.taxes.title' | translate }}</h1>
        <p class="s-header__subtitle">{{ 'settings.pages.taxes.subtitle' | translate }}</p>
      </div>
      <app-settings-section section="taxes" [groups]="groups" [policies]="policies" />
      <p class="s-links">{{ 'settings.sections.taxes_links' | translate }}
        <a routerLink="/masters/taxes">{{ 'settings.sections.go_tax_rates' | translate }}</a></p>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}.s-links{margin-top:1.5rem;font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxRulesPage {
  protected readonly groups: readonly AccountGroup[] = [
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
];
  protected readonly policies: readonly PolicyField[] = [
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
];
}
