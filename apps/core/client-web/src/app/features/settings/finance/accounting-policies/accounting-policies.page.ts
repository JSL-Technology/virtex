import { VxErrorStateComponent, VxSpinnerComponent } from '../../../../shared/components/feedback';
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
  imports: [TranslateModule, RouterLink, SettingsSectionComponent, SettingsSaveBarComponent, VxErrorStateComponent, VxSpinnerComponent],
  template: `
    @if (failed(); as message) {
      <vx-error-state [detail]="message" (retry)="retryAll()" />
    } @else if (loading()) {
      <vx-spinner size="lg" withLabel labelKey="settings.sections.loading" />
    }
    <div class="combined" [style.display]="failed() || loading() ? 'none' : null">
      @for (block of declarations; track block.section) {
        @if (block.policies.length || block.section === 'currencies') {
          <app-settings-section [section]="block.section" [groups]="[]" [policies]="block.policies" [embedded]="true" [quiet]="true"
            [showBaseCurrency]="block.section === 'currencies'" [titleKey]="block.titleKey"
            [anchor]="block.anchor === focus() ? block.anchor : null" />
        }
      }
      <!-- Los sitios relacionados, con el nombre de su página (CONT-03). -->
      <p class="combined__links">
        {{ 'settings.sections.policies_links' | translate }}
        <a routerLink="/masters/currencies">{{ 'page_titles.currencies' | translate }}</a> ·
        <a routerLink="/masters/taxes">{{ 'page_titles.taxes' | translate }}</a> ·
        <a routerLink="/accounting/periods">{{ 'page_titles.accounting_periods' | translate }}</a>
      </p>
      @if (canEdit()) {
        <vx-settings-save-bar [dirty]="dirty()" [saving]="saving()" (save)="save()" (discard)="discard()" />
      }
    </div>
  `,
  styles: [
    `
      /* Un bloque se separa del siguiente como cualquier grupo de la modal: por espacio (ESP-01). */
      .combined { display: block; }
      .combined__links { margin: 0; font-size: var(--text-sm); color: var(--content-secondary); }
      .combined__links a { color: var(--accent-text); }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountingPoliciesPage extends CombinedSettingsPage {
  protected readonly declarations = SECTION_DECLARATIONS;
}
