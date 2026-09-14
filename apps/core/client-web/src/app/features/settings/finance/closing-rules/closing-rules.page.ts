import { Component, ChangeDetectionStrategy } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, CalendarClock } from 'lucide-angular';
import { SettingsEmptyStateComponent } from '../../shared/settings-empty-state.component';

@Component({
  selector: 'app-closing-rules-page',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule, SettingsEmptyStateComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">{{ 'settings.pages.closing_rules.title' | translate }}</h1>
        <p class="s-header__subtitle">{{ 'settings.pages.closing_rules.manage_accounting_periods_locking_rules_govern' | translate }}</p>
      </div>
      <app-settings-empty-state [title]="'settings.pages.closing_rules.empty_title'"
        [description]="'settings.pages.closing_rules.empty_description'"
        [features]="['settings.pages.closing_rules.features.f1','settings.pages.closing_rules.features.f2','settings.pages.closing_rules.features.f3','settings.pages.closing_rules.features.f4','settings.pages.closing_rules.features.f5']">
        <lucide-icon slot="icon" [img]="icon" size="28"></lucide-icon>
      </app-settings-empty-state>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClosingRulesPage {
  protected readonly icon = CalendarClock;
}
