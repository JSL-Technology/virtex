import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AccountGroup, PolicyField, SettingsSectionComponent } from '../../shared/settings-section.component';

/** QA M-09: this section said «En desarrollo». It edits the organization's real settings now. */
@Component({
  selector: 'app-inventory-policies-settings-page',
  standalone: true,
  imports: [TranslateModule, RouterLink, SettingsSectionComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">{{ 'settings.pages.inventory_policies.title' | translate }}</h1>
        <p class="s-header__subtitle">{{ 'settings.pages.inventory_policies.subtitle' | translate }}</p>
      </div>
      <app-settings-section section="inventory" [groups]="groups" [policies]="policies" />
      <p class="s-links">{{ 'settings.sections.inventory_valuation_note' | translate }}</p>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}.s-links{margin-top:1.5rem;font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventoryPoliciesPage {
  protected readonly groups: readonly AccountGroup[] = [
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
];
  protected readonly policies: readonly PolicyField[] = [];
}
