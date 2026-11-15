import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SettingsSectionComponent } from '../../shared/settings-section.component';
import { COLLECTIONS_DECLARATION } from '../../finance/settings-declarations';

/**
 * Settings › Collections: whether payment reminders go out on their own, and on which days from the
 * due date (TES-13). The section saves through the same API every settings row section does, and
 * the API applies the same bounds as the column.
 */
@Component({
  selector: 'app-collections-settings-page',
  standalone: true,
  imports: [SettingsSectionComponent],
  template: `
    <app-settings-section
      [section]="declaration.section"
      [groups]="declaration.groups"
      [policies]="declaration.policies"
      [titleKey]="declaration.titleKey"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionsSettingsPage {
  protected readonly declaration = COLLECTIONS_DECLARATION;
}
