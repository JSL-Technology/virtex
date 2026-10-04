import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AccountGroup, PolicyField, SettingsSectionComponent } from '../../shared/settings-section.component';

/** QA M-09: this section said «En desarrollo». It edits the organization's real settings now. */
@Component({
  selector: 'app-intercompany-settings-page',
  standalone: true,
  imports: [TranslateModule, RouterLink, SettingsSectionComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">{{ 'settings.pages.intercompany.title' | translate }}</h1>
        <p class="s-header__subtitle">{{ 'settings.pages.intercompany.subtitle' | translate }}</p>
      </div>
      <app-settings-section section="intercompany" [groups]="groups" [policies]="policies" />
      <p class="s-links">{{ 'settings.sections.intercompany_links' | translate }}
        <a [routerLink]="[]" fragment="settings/subsidiaries">{{ 'settings.sections.go_structure' | translate }}</a></p>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}.s-links{margin-top:1.5rem;font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntercompanyPage {
  protected readonly groups: readonly AccountGroup[] = [
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
];
  protected readonly policies: readonly PolicyField[] = [];
}
