import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { SettingsSectionComponent } from '../../shared/settings-section.component';
import { SettingsSaveBarComponent } from '../../shell';
import { SECTION_DECLARATIONS } from '../settings-declarations';
import { CombinedSettingsPage } from '../combined-sections';

/**
 * Every default account in one place: sales, purchases, cash, assets, currency, taxes, closing,
 * intercompany and inventory — the accounts a posting uses when its document names none.
 *
 * They were spread over six sections (one of them with a single account), so reviewing the chart's
 * defaults meant six sections and six saves.
 */
@Component({
  selector: 'app-default-accounts-page',
  standalone: true,
  imports: [TranslateModule, RouterLink, SettingsSectionComponent, SettingsSaveBarComponent],
  template: `
    <div class="combined">
      @for (block of declarations; track block.section) {
        @if (block.groups.length) {
          <app-settings-section [section]="block.section" [groups]="block.groups" [policies]="[]" [embedded]="true"
            [titleKey]="block.titleKey" [anchor]="block.anchor === focus() ? block.anchor : null" />
        }
      }
      <p class="combined__links">
        {{ 'settings.sections.default_accounts_links' | translate }}
        <a routerLink="/accounting/chart-of-accounts">{{ 'settings.sections.go_chart_of_accounts' | translate }}</a>
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
export class DefaultAccountsPage extends CombinedSettingsPage {
  protected readonly declarations = SECTION_DECLARATIONS;
}
