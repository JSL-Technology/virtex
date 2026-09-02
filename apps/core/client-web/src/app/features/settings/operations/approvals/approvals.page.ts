import { Component, ChangeDetectionStrategy } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Workflow } from 'lucide-angular';
import { SettingsEmptyStateComponent } from '../../shared/settings-empty-state.component';

@Component({
  selector: 'app-approval-policies-page',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule, SettingsEmptyStateComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">{{ 'SETTINGS.PAGES.APPROVALS.TITLE' | translate }}</h1>
        <p class="s-header__subtitle">{{ 'SETTINGS.PAGES.APPROVALS.SUBTITLE' | translate }}</p>
      </div>
      <app-settings-empty-state [title]="'SETTINGS.PAGES.APPROVALS.EMPTY_TITLE'"
        [description]="'SETTINGS.PAGES.APPROVALS.EMPTY_DESCRIPTION'"
        [features]="['SETTINGS.PAGES.APPROVALS.FEATURES.F1','SETTINGS.PAGES.APPROVALS.FEATURES.F2','SETTINGS.PAGES.APPROVALS.FEATURES.F3','SETTINGS.PAGES.APPROVALS.FEATURES.F4','SETTINGS.PAGES.APPROVALS.FEATURES.F5']">
        <lucide-icon slot="icon" [img]="icon" size="28"></lucide-icon>
      </app-settings-empty-state>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApprovalPoliciesPage {
  protected readonly icon = Workflow;
}
