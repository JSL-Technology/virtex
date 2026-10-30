import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { SettingsSectionComponent } from '../../shared/settings-section.component';
import { SettingsSaveBarComponent } from '../../shell';
import { SECTION_DECLARATIONS } from '../settings-declarations';
import { CombinedSettingsPage } from '../combined-sections';

/**
 * The company's accounting and tax rules: the books' currency and how exchange rates are taken,
 * the default payment term, the taxpayer type, and how long fiscal documents are kept.
 *
 * Each lived beside a handful of accounts in a section of its own («Cierre fiscal» held one account
 * and one number). Rules are read and changed differently from accounts, so they have their page.
 */
@Component({
  selector: 'app-accounting-policies-page',
  standalone: true,
  imports: [TranslateModule, RouterLink, SettingsSectionComponent, SettingsSaveBarComponent],
  template: `
    <div class="combined">
      @for (block of declarations; track block.section) {
        @if (block.policies.length || block.section === 'currencies') {
          <app-settings-section [section]="block.section" [groups]="[]" [policies]="block.policies" [embedded]="true"
            [showBaseCurrency]="block.section === 'currencies'" [titleKey]="block.titleKey"
            [anchor]="block.anchor === focus() ? block.anchor : null" />
        }
      }
      <p class="combined__links">
        {{ 'settings.sections.policies_links' | translate }}
        <a routerLink="/masters/currencies">{{ 'settings.sections.go_currencies' | translate }}</a> ·
        <a routerLink="/masters/taxes">{{ 'settings.sections.go_tax_rates' | translate }}</a> ·
        <a routerLink="/accounting/periods">{{ 'settings.sections.go_periods' | translate }}</a>
      </p>
      @if (canEdit()) {
        <vx-settings-save-bar [dirty]="dirty()" [saving]="saving()" (save)="save()" (discard)="discard()" />
      }
    </div>
  `,
  styles: [
    `
      .combined { display: flex; flex-direction: column; gap: var(--space-8); }
      .combined app-settings-section + app-settings-section { padding-top: var(--space-6); border-top: 1px solid var(--border-color); }
      .combined__links { margin: 0; font-size: var(--text-sm); color: var(--content-secondary); }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountingPoliciesPage extends CombinedSettingsPage {
  protected readonly declarations = SECTION_DECLARATIONS;
}
