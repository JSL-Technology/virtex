import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AccountGroup, PolicyField, SettingsSectionComponent } from '../../shared/settings-section.component';

/** QA M-09: this section said «En desarrollo». It edits the organization's real settings now. */
@Component({
  selector: 'app-closing-rules-settings-page',
  standalone: true,
  imports: [TranslateModule, RouterLink, SettingsSectionComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">{{ 'settings.pages.closing_rules.title' | translate }}</h1>
        <p class="s-header__subtitle">{{ 'settings.pages.closing_rules.subtitle' | translate }}</p>
      </div>
      <app-settings-section section="closing" [groups]="groups" [policies]="policies" />
      <p class="s-links">{{ 'settings.sections.closing_links' | translate }}
        <a routerLink="/accounting/periods">{{ 'settings.sections.go_periods' | translate }}</a> ·
        <a routerLink="/accounting/closing/checklist">{{ 'settings.sections.go_closing_checklist' | translate }}</a></p>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}.s-links{margin-top:1.5rem;font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClosingRulesPage {
  protected readonly groups: readonly AccountGroup[] = [
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
];
  protected readonly policies: readonly PolicyField[] = [
  {
    field: 'fiscalArchiveAfterYears',
    labelKey: 'settings.sections.fields.fiscal_archive_after_years',
    helpKey: 'settings.sections.fields.fiscal_archive_after_years_help',
    kind: 'integer',
    min: 5,
    max: 30
  }
];
}
